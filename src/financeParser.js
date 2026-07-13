const { detectBank, isKnownBankSender } = require("./indianBanks");

const STRICT_BALANCE_PATTERNS = [
  /(?:Avl|Avbl|Aval|Available)\.?\s*Bal(?:ance)?[\s:]{0,8}(?:INR|Rs\.?|₹)\s*([0-9,]+\.[0-9]{2})/i,
  /(?:Avl|Avbl|Aval|Available)\.?\s*Bal(?:ance)?[\s:]{0,8}(?:INR|Rs\.?|₹)\s*([0-9,]+)/i,
  /(?:INR|Rs\.?|₹)\s*([0-9,]+\.[0-9]{2})\s+is\s+(?:your\s+)?(?:avl|available|aval)/i,
];

const AMOUNT_PATTERNS = [
  /(?:debited|withdrawn|paid|spent|purchase|dr)(?:\s+\w+){0,10}?\s*(?:for\s+)?(?:INR|Rs\.?|₹)\s*([0-9,]+\.?[0-9]*)/i,
  /(?:INR|Rs\.?|₹)\s*([0-9,]+\.?[0-9]*)\s*\/\-?\s*(?:has\s+been\s+)?(?:debited|withdrawn)/i,
  /(?:INR|Rs\.?|₹)\s*([0-9,]+\.?[0-9]*)\s+(?:has\s+been\s+)?(?:debited|credited|withdrawn|deposited|received)/i,
  /(?:debited|credited|withdrawn|deposited|received|paid)(?:\s+(?:by|with|for|of|to|from))?\s+(?:INR|Rs\.?|₹)\s*([0-9,]+\.?[0-9]*)/i,
  /(?:debited|credited|withdrawn|deposited|received|paid)\s+(?:of\s+)?(?:INR|Rs\.?|₹)\s*([0-9,]+\.?[0-9]*)/i,
  /(?:INR|Rs\.?|₹)\s*([0-9,]+\.?[0-9]*)\s+(?:debited|credited|withdrawn|deposited|received)/i,
];

const ACCOUNT_PATTERNS = [
  /(?:A\/C|account|acct)(?:\s+(?:no\.?|number|#))?[\s:*xX]+([xX*]{0,4}[0-9]{4})/i,
  /[xX*]{4,}([0-9]{4})/,
  /ending\s+(?:with\s+)?([0-9]{4})/i,
];

function hasExplicitBalance(text) {
  return /(?:Avl|Avbl|Aval|Avail|Available)\.?\s*Bal(?:ance)?/i.test(text);
}

function isPromotionalSms(text) {
  return /OTP|ONE[\s-]?TIME|OFFER|LOAN|INSURANCE|CASHBACK|WINNER|LOTTERY|CLICK\s|HTTP|WWW\.|UNSUBSCRIBE|BENEFIT|SCHEME|APPLY\s+NOW/i.test(
    text
  );
}

function toNum(val) {
  const n = parseFloat(String(val || "").replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

function extractBalance(text) {
  for (const pattern of STRICT_BALANCE_PATTERNS) {
    const match = text.match(pattern);
    if (!match || !match[1]) continue;
    const val = match[1].replace(/,/g, "");
    const num = toNum(val);
    if (num == null || num < 0 || num > 50_000_000) continue;
    if (num >= 100_000 && !match[1].includes(",") && val.replace(".", "").length > 7) continue;
    return val;
  }
  return null;
}

function extractTxnAmount(text, balance) {
  const candidates = [];
  for (const pattern of AMOUNT_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags + "g");
    let match;
    while ((match = regex.exec(text)) !== null) {
      const val = match[1].replace(/,/g, "");
      if (val !== balance && toNum(val) > 0) {
        candidates.push({ val, index: match.index });
      }
    }
  }
  if (!candidates.length) return null;
  const debitIdx = text.search(/debited|withdrawn|paid|spent|dr\b/i);
  const creditIdx = text.search(/credited|deposited|received/i);
  const keywordIdx = debitIdx >= 0 ? debitIdx : creditIdx;
  if (keywordIdx >= 0) {
    const near = candidates.filter((c) => Math.abs(c.index - keywordIdx) < 50);
    if (near.length) return near[0].val;
  }
  return candidates[0].val;
}

function isConsistent(balance, txnAmount, text) {
  const balNum = toNum(balance);
  if (balNum == null) return false;

  const txnNum = txnAmount ? toNum(txnAmount) : null;
  const hasTxnWord = /credited|debited|withdrawn|deposited/i.test(text);

  if (txnNum != null && txnNum > 0) {
    const ratio = balNum / txnNum;
    if (ratio > 10000 || ratio < 0.001) return false;
  }

  if (hasTxnWord && txnNum == null && balNum > 200_000) return false;
  if (hasTxnWord && txnNum == null && !/(?:A\/C|account|acct)/i.test(text)) return false;

  return true;
}

function parseBankSms(text, sender) {
  if (!text || text.trim().length < 8) return null;
  if (isPromotionalSms(text)) return null;

  const upper = text.toUpperCase();
  const knownSender = isKnownBankSender(sender);
  const hasTxnWords = /CREDITED|DEBITED|WITHDRAWN|DEPOSITED|A\/C|ACCOUNT|PAID|SPENT|PURCHASE|\bDR\b|UPI|IMPS|NEFT|RTGS|TRANSACTION/i.test(upper);

  if (!hasExplicitBalance(text)) return null;
  if (!hasTxnWords && !knownSender) return null;

  const balance = extractBalance(text);
  if (!balance) return null;

  const txnAmount = extractTxnAmount(text, balance);
  if (!isConsistent(balance, txnAmount, text)) return null;

  let txnType = null;
  if (txnAmount && /credit(?:ed)?|received|deposited/i.test(text)) txnType = "credit";
  else if (txnAmount && /debit(?:ed)?|withdraw|paid|purchase|spent|\bdr\b/i.test(text)) txnType = "debit";

  let accountLast4 = null;
  for (const pattern of ACCOUNT_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      accountLast4 = match[1].replace(/[^0-9]/g, "").slice(-4);
      break;
    }
  }

  const bankInfo = detectBank(sender, text);

  return {
    bankName: bankInfo.name,
    bankCategory: bankInfo.category,
    senderName: sender || "Unknown",
    availableBalance: balance,
    transactionAmount: txnAmount,
    transactionType: txnType,
    accountLast4,
    rawSms: text.slice(0, 200),
  };
}

function parseSmsList(data) {
  const list = [];
  if (!data || typeof data !== "object") return list;
  const entries = Object.entries(data);
  const slice = entries.length > 500 ? entries.slice(entries.length - 500) : entries;
  for (const [, raw] of slice) {
    if (!raw || typeof raw !== "object") continue;
    const text = String(raw.message || raw.body || raw.text || "").trim();
    if (!text) continue;
    list.push({
      text,
      sender: String(raw.sender || raw.from || "Unknown"),
      time: String(raw.dateTime || raw.date || ""),
    });
  }
  return list.reverse();
}

function toNumber(val) {
  const n = parseFloat(String(val || "0").replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function formatMoney(val) {
  return toNumber(val).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function bankKey(entry) {
  return `${entry.bankName}|${entry.accountLast4 || "xxxx"}`;
}

function inferBalanceChanges(bank) {
  const sorted = [...bank.transactions].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.type !== "balance" || curr.amount) continue;
    const diff = Math.round((toNumber(prev.balance) - toNumber(curr.balance)) * 100) / 100;
    if (Math.abs(diff) < 0.01) continue;
    if (diff > 0) {
      curr.type = "debit";
      curr.amount = String(diff);
      bank.totalDebit += diff;
      bank.debitCount += 1;
    } else {
      const credit = Math.abs(diff);
      curr.type = "credit";
      curr.amount = String(credit);
      bank.totalCredit += credit;
      bank.creditCount += 1;
    }
  }
}

function buildFinanceReport(messagesData) {
  const smsList = parseSmsList(messagesData);
  const parsed = [];
  for (const sms of smsList) {
    const entry = parseBankSms(sms.text, sms.sender);
    if (!entry) continue;
    entry.detectedAt = sms.time || new Date().toISOString();
    parsed.push(entry);
  }

  const bankMap = new Map();
  for (const entry of parsed) {
    const key = bankKey(entry);
    if (!bankMap.has(key)) {
      bankMap.set(key, {
        bankName: entry.bankName,
        bankCategory: entry.bankCategory,
        accountLast4: entry.accountLast4,
        availableBalance: entry.availableBalance,
        totalCredit: 0,
        totalDebit: 0,
        creditCount: 0,
        debitCount: 0,
        transactions: [],
        lastUpdated: entry.detectedAt,
      });
    }
    const bank = bankMap.get(key);
    bank.transactions.push({
      type: entry.transactionType || "balance",
      amount: entry.transactionAmount,
      balance: entry.availableBalance,
      time: entry.detectedAt,
      sender: entry.senderName,
    });

    if (entry.transactionType === "credit" && entry.transactionAmount) {
      bank.totalCredit += toNumber(entry.transactionAmount);
      bank.creditCount += 1;
    } else if (entry.transactionType === "debit" && entry.transactionAmount) {
      bank.totalDebit += toNumber(entry.transactionAmount);
      bank.debitCount += 1;
    }

    bank.availableBalance = entry.availableBalance;
    bank.bankCategory = entry.bankCategory;
    bank.lastUpdated = entry.detectedAt;
  }

  for (const bank of bankMap.values()) {
    inferBalanceChanges(bank);
  }

  const banks = [...bankMap.values()]
    .map((b) => ({
      ...b,
      totalCredit: formatMoney(b.totalCredit),
      totalDebit: formatMoney(b.totalDebit),
      availableBalance: formatMoney(b.availableBalance),
      transactionCount: b.transactions.length,
    }))
    .sort((a, b) => toNumber(b.availableBalance) - toNumber(a.availableBalance));

  let sumCredit = 0;
  let sumDebit = 0;
  let sumBalance = 0;
  let creditCount = 0;
  let debitCount = 0;

  for (const b of bankMap.values()) {
    sumCredit += b.totalCredit;
    sumDebit += b.totalDebit;
    sumBalance += toNumber(b.availableBalance);
    creditCount += b.creditCount;
    debitCount += b.debitCount;
  }

  return {
    summary: {
      bankCount: banks.length,
      totalBalance: formatMoney(sumBalance),
      totalCredit: formatMoney(sumCredit),
      totalDebit: formatMoney(sumDebit),
      creditCount,
      debitCount,
      smsScanned: smsList.length,
      bankSmsFound: parsed.length,
      supportedBanks: require("./indianBanks").BANKS.length,
    },
    banks,
  };
}

module.exports = { buildFinanceReport, parseBankSms, parseSmsList };
