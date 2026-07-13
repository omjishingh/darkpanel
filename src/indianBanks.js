const BANKS = [
  { name: "Bank of Baroda", category: "Public Sector", aliases: ["BOBTXN", "BOBSMS", "BARODA", "BANKBARODA", "BKBARODA"] },
  { name: "Bank of India", category: "Public Sector", aliases: ["BOIIND", "BKINDIA", "BANKINDIA"] },
  { name: "Bank of Maharashtra", category: "Public Sector", aliases: ["MAHABK", "MAHABANK", "BOMBK"] },
  { name: "Canara Bank", category: "Public Sector", aliases: ["CANBNK", "CANARA", "CNRBNK"] },
  { name: "Central Bank of India", category: "Public Sector", aliases: ["CENTBK", "CBOT", "CBIND", "CENTRALBK"] },
  { name: "Indian Bank", category: "Public Sector", aliases: ["INDBNK", "INDIANB", "INDIANBK"] },
  { name: "Indian Overseas Bank", category: "Public Sector", aliases: ["IOBCHN", "IOBSMS", "IOBANK"] },
  { name: "Punjab & Sind Bank", category: "Public Sector", aliases: ["PSBIND", "PSBANK", "PNBSIND"] },
  { name: "Punjab National Bank", category: "Public Sector", aliases: ["PNBSMS", "PNBANK", "PNB"] },
  { name: "State Bank of India", category: "Public Sector", aliases: ["SBIINB", "SBIIN", "SBIUPI", "SBIPSG", "SBIBNK", "CBSSBI", "CBSBRI", "SBI"] },
  { name: "UCO Bank", category: "Public Sector", aliases: ["UCOBNK", "UCOBANK", "UCOBK"] },
  { name: "Union Bank of India", category: "Public Sector", aliases: ["UNIONB", "UBISMS", "UNIONBK", "UBI"] },

  { name: "Axis Bank", category: "Private Sector", aliases: ["AXISBK", "AXISBANK", "AXIS"] },
  { name: "Bandhan Bank", category: "Private Sector", aliases: ["BANDHAN", "BDBL", "BANDHN"] },
  { name: "CSB Bank", category: "Private Sector", aliases: ["CSBBNK", "CSBBANK", "CSB"] },
  { name: "City Union Bank", category: "Private Sector", aliases: ["CUBANK", "CUBSMS", "CITYUNION"] },
  { name: "DCB Bank", category: "Private Sector", aliases: ["DCBBNK", "DCBBANK", "DCB"] },
  { name: "Dhanlaxmi Bank", category: "Private Sector", aliases: ["DHANBK", "DHANLAX", "DLBANK"] },
  { name: "Federal Bank", category: "Private Sector", aliases: ["FEDERAL", "FEDBNK", "FEDBANK"] },
  { name: "HDFC Bank", category: "Private Sector", aliases: ["HDFCBK", "HDFCBANK", "HDFC"] },
  { name: "ICICI Bank", category: "Private Sector", aliases: ["ICICIB", "ICICIBK", "ICICI"] },
  { name: "IndusInd Bank", category: "Private Sector", aliases: ["INDUSB", "INDUSIND", "IIB"] },
  { name: "IDFC First Bank", category: "Private Sector", aliases: ["IDFCFB", "IDFCBK", "IDFCFIRST", "IDFC"] },
  { name: "Jammu & Kashmir Bank", category: "Private Sector", aliases: ["JAKBNK", "JKBANK", "JKB"] },
  { name: "Karnataka Bank", category: "Private Sector", aliases: ["KTKBNK", "KARNBK", "KTKBANK"] },
  { name: "Karur Vysya Bank", category: "Private Sector", aliases: ["KVBANK", "KVBSMS", "KVB"] },
  { name: "Kotak Mahindra Bank", category: "Private Sector", aliases: ["KOTAKB", "KOTAKBK", "KOTAK"] },
  { name: "Nainital Bank", category: "Private Sector", aliases: ["NTLBNK", "NAINITAL", "NTB"] },
  { name: "RBL Bank", category: "Private Sector", aliases: ["RBLBNK", "RBLBANK", "RBL"] },
  { name: "South Indian Bank", category: "Private Sector", aliases: ["SIBSMS", "SIBANK", "SIB"] },
  { name: "Tamilnad Mercantile Bank", category: "Private Sector", aliases: ["TMBANK", "TMBSMS", "TMB"] },
  { name: "YES Bank", category: "Private Sector", aliases: ["YESBNK", "YESBANK", "YES"] },
  { name: "IDBI Bank", category: "Private Sector", aliases: ["IDBIBK", "IDBIBANK", "IDBI"] },

  { name: "Au Small Finance Bank", category: "Small Finance", aliases: ["AUSFBK", "AUSFB", "AUBANK"] },
  { name: "Capital Small Finance Bank", category: "Small Finance", aliases: ["CAPSFB", "CAPSF", "CAPITALSF"] },
  { name: "Equitas Small Finance Bank", category: "Small Finance", aliases: ["EQUTAS", "EQUTSF", "EQUITAS"] },
  { name: "Suryoday Small Finance Bank", category: "Small Finance", aliases: ["SURYDY", "SURYOD", "SURYODAY"] },
  { name: "Ujjivan Small Finance Bank", category: "Small Finance", aliases: ["UJJIVN", "UJJIVAN", "UJJSF"] },
  { name: "Utkarsh Small Finance Bank", category: "Small Finance", aliases: ["UTKARS", "UTKARSH", "UTKSFB"] },
  { name: "ESAF Small Finance Bank", category: "Small Finance", aliases: ["ESAFSF", "ESAFBK", "ESAF"] },
  { name: "Fincare Small Finance Bank", category: "Small Finance", aliases: ["FINCRB", "FINCARE", "FNCARE"] },
  { name: "Jana Small Finance Bank", category: "Small Finance", aliases: ["JANASF", "JANABK", "JANASFB"] },
  { name: "North East Small Finance Bank", category: "Small Finance", aliases: ["NESFBK", "NESFB", "NESTSF"] },
  { name: "Shivalik Small Finance Bank", category: "Small Finance", aliases: ["SHVLK", "SHIVALK", "SHVLKSF"] },
  { name: "Unity Small Finance Bank", category: "Small Finance", aliases: ["UTYSFB", "UNITYSF", "UNITYBK"] },

  { name: "India Post Payments Bank", category: "Payments Bank", aliases: ["IPPB", "IPPBK", "POSTPAY"] },
  { name: "Fino Payments Bank", category: "Payments Bank", aliases: ["FINOBK", "FINOPB", "FINO"] },
  { name: "Paytm Payments Bank", category: "Payments Bank", aliases: ["PAYTMB", "PAYTMP", "PAYTM"] },
  { name: "Airtel Payments Bank", category: "Payments Bank", aliases: ["AIRBNK", "AIRTEL", "AIRPAY"] },

  { name: "Andhra Pragathi Grameena Bank", category: "Regional Rural", aliases: ["APGBNK", "APGB", "APGRAMEEN"] },
  { name: "Andhra Pradesh Grameena Vikas Bank", category: "Regional Rural", aliases: ["APGVB", "APGVBK"] },
  { name: "Arunachal Pradesh Rural Bank", category: "Regional Rural", aliases: ["APRB", "APRURAL"] },
  { name: "Aryavart Bank", category: "Regional Rural", aliases: ["ARYAVT", "ARYAVRT", "ARYBK"] },
  { name: "Assam Gramin Vikash Bank", category: "Regional Rural", aliases: ["AGVB", "AGVBK", "ASSAMGV"] },
  { name: "Bangiya Gramin Vikas Bank", category: "Regional Rural", aliases: ["BGVB", "BGVBK", "BANGIYA"] },
  { name: "Baroda Gujarat Gramin Bank", category: "Regional Rural", aliases: ["BGGB", "BGGBK", "BOBGG"] },
  { name: "Baroda Rajasthan Kshetriya Gramin Bank", category: "Regional Rural", aliases: ["BRKGB", "BRKGBK", "BOBRK"] },
  { name: "Baroda UP Bank", category: "Regional Rural", aliases: ["BUPGBX", "BUPGB", "BOBUP", "BOBUPB", "BARODAUP"] },
  { name: "Chaitanya Godavari Grameena Bank", category: "Regional Rural", aliases: ["CGGB", "CGGBK", "CHAITANYA"] },
  { name: "Chhattisgarh Rajya Gramin Bank", category: "Regional Rural", aliases: ["CGB", "CGRGB", "CHHATTISGARH"] },
  { name: "Dakshin Bihar Gramin Bank", category: "Regional Rural", aliases: ["DBGB", "DBGBK", "DAKSHINBIHAR"] },
  { name: "Ellaquai Dehati Bank", category: "Regional Rural", aliases: ["EDB", "EDBK", "ELLAQUAI"] },
  { name: "Himachal Pradesh Gramin Bank", category: "Regional Rural", aliases: ["HPGB", "HPGBK", "HIMACHAL"] },
  { name: "J&K Grameen Bank", category: "Regional Rural", aliases: ["JKGB", "JKGBK", "JKGRAMEEN"] },
  { name: "Jharkhand Rajya Gramin Bank", category: "Regional Rural", aliases: ["JRGB", "JRGBK", "JHARKHAND"] },
  { name: "Karnataka Gramin Bank", category: "Regional Rural", aliases: ["KGB", "KGBK", "KARNGRAM"] },
  { name: "Karnataka Vikas Grameena Bank", category: "Regional Rural", aliases: ["KVGB", "KVGBK", "KARVIKAS"] },
  { name: "Kerala Gramin Bank", category: "Regional Rural", aliases: ["KERGB", "KGBKL", "KERALAGB"] },
  { name: "Madhya Pradesh Gramin Bank", category: "Regional Rural", aliases: ["MPGB", "MPGBK", "MADHYAPRADESH"] },
  { name: "Madhyanchal Gramin Bank", category: "Regional Rural", aliases: ["MGB", "MGBK", "MADHYANCHAL"] },
  { name: "Maharashtra Gramin Bank", category: "Regional Rural", aliases: ["MAHGB", "MAHGBK", "MAHGRAM"] },
  { name: "Manipur Rural Bank", category: "Regional Rural", aliases: ["MRB", "MRBK", "MANIPUR"] },
  { name: "Meghalaya Rural Bank", category: "Regional Rural", aliases: ["MERB", "MERBK", "MEGHALAYA"] },
  { name: "Mizoram Rural Bank", category: "Regional Rural", aliases: ["MIZRB", "MIZRBK", "MIZORAM"] },
  { name: "Nagaland Rural Bank", category: "Regional Rural", aliases: ["NARB", "NARBK", "NAGALAND"] },
  { name: "Odisha Gramya Bank", category: "Regional Rural", aliases: ["OGB", "OGBK", "ODISHAGB"] },
  { name: "Paschim Banga Grama Bank", category: "Regional Rural", aliases: ["PBGB", "PBGBK", "PASCHIMBANGA"] },
  { name: "Prathama UP Gramin Bank", category: "Regional Rural", aliases: ["PUPGB", "PUPGBK", "PRATHAMA"] },
  { name: "Puduvai Bharathiar Grama Bank", category: "Regional Rural", aliases: ["PBGBP", "PUDUVAI", "PONDICHERRY"] },
  { name: "Punjab Gramin Bank", category: "Regional Rural", aliases: ["PGBK", "PUNJABGB", "PNJBG"] },
  { name: "Rajasthan Marudhara Gramin Bank", category: "Regional Rural", aliases: ["RMGB", "RMGBK", "MARUDHARA"] },
  { name: "Saptagiri Grameena Bank", category: "Regional Rural", aliases: ["SGB", "SGBK", "SAPTAGIRI"] },
  { name: "Sarva Haryana Gramin Bank", category: "Regional Rural", aliases: ["SHGB", "SHGBK", "SARVAHARYANA"] },
  { name: "Saurashtra Gramin Bank", category: "Regional Rural", aliases: ["SAGB", "SAGBK", "SAURASHTRA"] },
  { name: "Tamil Nadu Grama Bank", category: "Regional Rural", aliases: ["TNGB", "TNGBK", "TAMILNADU"] },
  { name: "Telangana Grameena Bank", category: "Regional Rural", aliases: ["TGB", "TGBK", "TELANGANA"] },
  { name: "Tripura Gramin Bank", category: "Regional Rural", aliases: ["TRGB", "TRGBK", "TRIPURA"] },
  { name: "Utkal Grameen Bank", category: "Regional Rural", aliases: ["UGB", "UGBK", "UTKAL"] },
  { name: "Uttar Bihar Gramin Bank", category: "Regional Rural", aliases: ["UBGB", "UBGBK", "UTTARBIHAR"] },
  { name: "Uttarakhand Gramin Bank", category: "Regional Rural", aliases: ["UKGB", "UKGBK", "UTTARAKHAND"] },
  { name: "Uttarbanga Kshetriya Gramin Bank", category: "Regional Rural", aliases: ["UBKGB", "UBKGBK", "UTTARBANGA"] },
  { name: "Vidharbha Konkan Gramin Bank", category: "Regional Rural", aliases: ["VKGB", "VKGBK", "VIDHARBHA"] },

  { name: "AB Bank", category: "Foreign Bank", aliases: ["ABBANK", "ABB"] },
  { name: "Abu Dhabi Commercial Bank", category: "Foreign Bank", aliases: ["ADCB", "ADCBK"] },
  { name: "American Express", category: "Foreign Bank", aliases: ["AMEX", "AMEXBK", "AMERICANEXPRESS"] },
  { name: "ANZ Bank", category: "Foreign Bank", aliases: ["ANZBK", "ANZBANK"] },
  { name: "Barclays Bank", category: "Foreign Bank", aliases: ["BARCLY", "BARCLAYS"] },
  { name: "Bank of America", category: "Foreign Bank", aliases: ["BOFA", "BOAMERICA", "BANKAMERICA"] },
  { name: "Bank of Bahrain & Kuwait", category: "Foreign Bank", aliases: ["BBK", "BBKBK"] },
  { name: "Bank of Ceylon", category: "Foreign Bank", aliases: ["BOC", "BOCEYLON"] },
  { name: "Bank of China", category: "Foreign Bank", aliases: ["BOCHINA", "BCHINA"] },
  { name: "Bank of Nova Scotia", category: "Foreign Bank", aliases: ["SCOTIA", "BNS"] },
  { name: "BNP Paribas", category: "Foreign Bank", aliases: ["BNPP", "BNPPARIBAS"] },
  { name: "Citibank", category: "Foreign Bank", aliases: ["CITIBK", "CITI", "CITIBANK"] },
  { name: "Cooperatieve Rabobank", category: "Foreign Bank", aliases: ["RABOBK", "RABOBANK"] },
  { name: "Credit Agricole", category: "Foreign Bank", aliases: ["CRAGRI", "CREDAGR"] },
  { name: "Credit Suisse", category: "Foreign Bank", aliases: ["CSUISSE", "CREDSUISSE"] },
  { name: "CTBC Bank", category: "Foreign Bank", aliases: ["CTBC", "CTBCBK"] },
  { name: "DBS Bank India", category: "Foreign Bank", aliases: ["DBSBK", "DBSIND", "DBS"] },
  { name: "Deutsche Bank", category: "Foreign Bank", aliases: ["DEUTBK", "DEUTSCHE"] },
  { name: "Doha Bank", category: "Foreign Bank", aliases: ["DOHABK", "DOHABANK"] },
  { name: "Emirates NBD", category: "Foreign Bank", aliases: ["EMIRATES", "ENBD"] },
  { name: "First Abu Dhabi Bank", category: "Foreign Bank", aliases: ["FAB", "FABBK"] },
  { name: "FirstRand Bank", category: "Foreign Bank", aliases: ["FIRSTRAND", "FRB"] },
  { name: "HSBC", category: "Foreign Bank", aliases: ["HSBC", "HSBCBK"] },
  { name: "ICBC", category: "Foreign Bank", aliases: ["ICBC", "ICBCBK"] },
  { name: "Industrial Bank of Korea", category: "Foreign Bank", aliases: ["IBK", "IBKBK"] },
  { name: "J.P. Morgan Chase", category: "Foreign Bank", aliases: ["JPMORGAN", "JPMCHASE", "CHASE"] },
  { name: "JSC VTB Bank", category: "Foreign Bank", aliases: ["VTB", "VTBBK"] },
  { name: "KEB Hana Bank", category: "Foreign Bank", aliases: ["KEBHANA", "HANABK"] },
  { name: "Kookmin Bank", category: "Foreign Bank", aliases: ["KOOKMIN", "KBSTAR"] },
  { name: "Krung Thai Bank", category: "Foreign Bank", aliases: ["KRUNGTHAI", "KTB"] },
  { name: "Mashreq Bank", category: "Foreign Bank", aliases: ["MASHREQ", "MASHBK"] },
  { name: "Mizuho Bank", category: "Foreign Bank", aliases: ["MIZUHO", "MIZUBK"] },
  { name: "MUFG Bank", category: "Foreign Bank", aliases: ["MUFG", "MUFGbk"] },
  { name: "NatWest Markets", category: "Foreign Bank", aliases: ["NATWEST", "RBS"] },
  { name: "Maybank Indonesia", category: "Foreign Bank", aliases: ["MAYBANK", "MAYBK"] },
  { name: "Qatar National Bank", category: "Foreign Bank", aliases: ["QNB", "QNBBK"] },
  { name: "Sberbank", category: "Foreign Bank", aliases: ["SBER", "SBERBK"] },
  { name: "SBM Bank India", category: "Foreign Bank", aliases: ["SBMBK", "SBMIND"] },
  { name: "Shinhan Bank", category: "Foreign Bank", aliases: ["SHINHAN", "SHINBK"] },
  { name: "Societe Generale", category: "Foreign Bank", aliases: ["SOCGEN", "SOCIETE"] },
  { name: "Sonali Bank", category: "Foreign Bank", aliases: ["SONALI", "SONALIBK"] },
  { name: "Standard Chartered", category: "Foreign Bank", aliases: ["SCB", "STANCHART", "SCBANK"] },
  { name: "Sumitomo Mitsui Banking", category: "Foreign Bank", aliases: ["SMBC", "SUMITOMO"] },
  { name: "United Overseas Bank", category: "Foreign Bank", aliases: ["UOB", "UOBBK"] },
  { name: "Woori Bank", category: "Foreign Bank", aliases: ["WOORI", "WOORIBK"] },

  { name: "PhonePe", category: "Digital Wallet", aliases: ["PHONEPE", "PHNPE"] },
  { name: "Google Pay", category: "Digital Wallet", aliases: ["GPAY", "GOOGLEPAY", "GGLPAY"] },
  { name: "Amazon Pay", category: "Digital Wallet", aliases: ["AMAZONPAY", "AMZPAY"] },
  { name: "Bajaj Finance", category: "Digital Wallet", aliases: ["BAJAJFIN", "BAJAJ"] },
  { name: "CRED", category: "Digital Wallet", aliases: ["CRED", "CREDCLUB"] },
  { name: "Jio Money", category: "Digital Wallet", aliases: ["JIOMNY", "JIOMONEY", "JIO"] },
  { name: "BHIM UPI", category: "Digital Wallet", aliases: ["BHIM", "NPCI", "UPI"] },
  { name: "Mobikwik", category: "Digital Wallet", aliases: ["MOBIKWIK", "MBKWIK"] },
  { name: "Freecharge", category: "Digital Wallet", aliases: ["FREECHARGE", "FRCHRG"] },
];

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ALIAS_INDEX = [];
for (const bank of BANKS) {
  for (const alias of bank.aliases) {
    const upper = String(alias).toUpperCase();
    if (upper.length < 3) continue;
    ALIAS_INDEX.push({
      alias: upper,
      name: bank.name,
      category: bank.category,
      len: upper.length,
    });
  }
}
ALIAS_INDEX.sort((a, b) => b.len - a.len);

function normalizeSenderCode(sender) {
  const s = String(sender || "").toUpperCase().trim();
  const stripped = s.replace(
    /^(?:VM|AD|VK|JD|AX|BT|CP|BP|IM|JM|TX|AM|BW|DW|EQ|GH|HP|IA|ID|IF|IG|II|IL|IN|IO|IP|IQ|IR|IS|IT|IU|IV|IW|IX|IY|IZ)-/,
    ""
  );
  return stripped.replace(/^[A-Z]{2,3}-/, "");
}

function matchSenderCode(code) {
  if (!code) return null;
  const upper = String(code).toUpperCase();
  for (const entry of ALIAS_INDEX) {
    if (upper === entry.alias) {
      return { name: entry.name, category: entry.category };
    }
  }
  for (const entry of ALIAS_INDEX) {
    if (entry.len >= 5 && upper.startsWith(entry.alias)) {
      return { name: entry.name, category: entry.category };
    }
  }
  return null;
}

function matchBankInText(text) {
  if (!text) return null;
  const upper = String(text).toUpperCase();
  for (const entry of ALIAS_INDEX) {
    if (entry.len < 5) continue;
    if (upper.includes(entry.alias)) {
      return { name: entry.name, category: entry.category };
    }
  }
  for (const bank of BANKS) {
    const label = bank.name.replace(/\s+(Ltd\.?|Limited)$/gi, "").toUpperCase();
    if (label.length >= 8 && upper.includes(label)) {
      return { name: bank.name, category: bank.category };
    }
  }
  return null;
}

function isKnownBankSender(sender) {
  return !!matchSenderCode(normalizeSenderCode(sender));
}

function detectBank(sender, text) {
  const fromCode = matchSenderCode(normalizeSenderCode(sender));
  if (fromCode) return fromCode;
  const fromSender = matchSenderCode(String(sender || "").toUpperCase());
  if (fromSender) return fromSender;
  const fromText = matchBankInText(text);
  if (fromText) return fromText;
  const match = String(sender || "").toUpperCase().match(/(?:[A-Z]{2}-)?([A-Z0-9]{4,})/);
  return {
    name: match ? match[1] : sender || "Unknown Bank",
    category: "Other",
  };
}

module.exports = {
  BANKS,
  ALIAS_INDEX,
  detectBank,
  matchSenderCode,
  matchBankInText,
  isKnownBankSender,
  normalizeSenderCode,
};
