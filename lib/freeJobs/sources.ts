import type { FreeJobSource } from "./types";

// Employers whose career sites are read for free through the public endpoint
// their own careers page uses. Every entry below returned live jobs when it
// was added; to add one, find its platform from a job's apply URL:
//   *.oraclecloud.com/hcmUI/CandidateExperience/en/sites/<site>/job/<id> -> oracle
//   <tenant>.wdN.myworkdayjobs.com/<site>/job/...                         -> workday
//   jobs.smartrecruiters.com/<companyId>/...                              -> smartrecruiters
//   jobs.lever.co/<slug>/...  |  boards.greenhouse.io/<slug>/...          -> lever / greenhouse
// then confirm the adapter lists jobs before committing.
//
// Global employers (searchText / keyword "Abu Dhabi") are narrowed at the
// source so the Abu Dhabi roles are not buried under other countries.
export const FREE_JOB_SOURCES: readonly FreeJobSource[] = [
  // --- Abu Dhabi-headquartered ---
  { id: "abu-dhabi-airports", employer: "Abu Dhabi Airports", adapter: "oracle", host: "hcts.fa.em2.oraclecloud.com", site: "CX_1" },
  { id: "adib", employer: "ADIB", adapter: "oracle", host: "hciq.fa.em2.oraclecloud.com", site: "CX" },
  { id: "ad-ports", employer: "AD Ports Group", adapter: "oracle", host: "fa-ewzx-saasfaprod1.fa.ocs.oraclecloud.com", site: "CX_1" },
  { id: "ssmc", employer: "SSMC", adapter: "oracle", host: "fa-eutv-saasfaprod1.fa.ocs.oraclecloud.com", site: "CX_1001" },
  { id: "fab", employer: "First Abu Dhabi Bank", adapter: "oracle", host: "ehjd.fa.em2.oraclecloud.com", site: "fabCareers" },
  { id: "aldar", employer: "Aldar Properties", adapter: "lever", slug: "aldar" },
  { id: "masdar", employer: "Masdar", adapter: "smartrecruiters", companyId: "Masdar" },
  { id: "etihad", employer: "Etihad Airways", adapter: "smartrecruiters", companyId: "EtihadAirways5" },
  { id: "nmc", employer: "NMC Healthcare", adapter: "oracle", host: "eiby.fa.em2.oraclecloud.com", site: "CX_1", keyword: "Abu Dhabi" },
  { id: "ghobash", employer: "Ghobash Group", adapter: "smartrecruiters", companyId: "GhobashGroup" },

  // --- Government, sovereign and national champions ---
  { id: "adnoc", employer: "ADNOC", adapter: "phenom", host: "jobs.adnoc.ae", locale: "us/en" },
  { id: "g42", employer: "G42", adapter: "phenom", host: "careers.g42.ai", locale: "global/en" },
  { id: "adia", employer: "ADIA", adapter: "workable", account: "adia" },
  { id: "eia", employer: "Emirates Investment Authority", adapter: "workable", account: "emirates-investment-authority" },
  { id: "adgm", employer: "ADGM", adapter: "oracle", host: "fa-eukk-saasfaprod1.fa.ocs.oraclecloud.com", site: "CX_1" },
  { id: "etisalat", employer: "e&", adapter: "oracle", host: "iaayey.fa.ocs.oraclecloud26.com", site: "CX_1" },
  { id: "nmdc", employer: "NMDC Group", adapter: "oracle", host: "fa-evft-saasfaprod1.fa.ocs.oraclecloud.com", site: "CX_1001" },
  { id: "khalifa-university", employer: "Khalifa University", adapter: "oracle", host: "iaaibv.fa.ocs.oraclecloud29.com", site: "CX_2002" },
  { id: "edge", employer: "EDGE Group", adapter: "successfactors", host: "careers.edgegroup.ae" },
  { id: "adcb", employer: "ADCB", adapter: "successfactors", host: "adcbcareers.com" },
  { id: "enec", employer: "ENEC", adapter: "successfactors", host: "careers.enec.ae" },
  { id: "borouge", employer: "Borouge", adapter: "successfactors", host: "careers.borouge.com" },

  { id: "ega", employer: "Emirates Global Aluminium", adapter: "successfactors", host: "careers.ega.ae" },
  { id: "miral", employer: "Miral", adapter: "oracle", host: "enpk.fa.em8.oraclecloud.com", site: "CX_4001" },
  { id: "zayed-university", employer: "Zayed University", adapter: "oracle", host: "fa-evge-saasfaprod1.fa.ocs.oraclecloud.com", site: "CX_1" },

  // --- Global employers hiring managers in Abu Dhabi ---
  { id: "worley", employer: "Worley", adapter: "eightfold", host: "jobs.worley.com", domain: "worley.com" },
  { id: "kpmg", employer: "KPMG Lower Gulf", adapter: "oracle", host: "elzw.fa.em8.oraclecloud.com", site: "CX_1001", keyword: "Abu Dhabi" },
  { id: "marsh-mclennan", employer: "Marsh McLennan", adapter: "workday", host: "mmc.wd1.myworkdayjobs.com", tenant: "mmc", site: "MMC", searchText: "Abu Dhabi" },
  { id: "thales", employer: "Thales", adapter: "workday", host: "thales.wd3.myworkdayjobs.com", tenant: "thales", site: "Careers", searchText: "Abu Dhabi" },
  { id: "abb", employer: "ABB", adapter: "workday", host: "abb.wd3.myworkdayjobs.com", tenant: "abb", site: "External_Career_Page", searchText: "Abu Dhabi" },
  { id: "kbr", employer: "KBR", adapter: "workday", host: "kbr.wd5.myworkdayjobs.com", tenant: "kbr", site: "KBR_Careers", searchText: "Abu Dhabi" },
  { id: "parsons", employer: "Parsons", adapter: "workday", host: "parsons.wd5.myworkdayjobs.com", tenant: "parsons", site: "Search", searchText: "Abu Dhabi" },
  { id: "state-street", employer: "State Street", adapter: "workday", host: "statestreet.wd1.myworkdayjobs.com", tenant: "statestreet", site: "Global", searchText: "Abu Dhabi" },
  { id: "rtx", employer: "RTX", adapter: "workday", host: "globalhr.wd5.myworkdayjobs.com", tenant: "globalhr", site: "REC_RTX_Ext_Gateway", searchText: "Abu Dhabi" },
  { id: "wood", employer: "Wood", adapter: "oracle", host: "ehif.fa.em2.oraclecloud.com", site: "CX_1", keyword: "Abu Dhabi" },
  { id: "wsp", employer: "WSP", adapter: "oracle", host: "emit.fa.ca3.oraclecloud.com", site: "CX_2001", keyword: "Abu Dhabi" },
  { id: "aecom", employer: "AECOM", adapter: "smartrecruiters", companyId: "AECOM2" },
  { id: "egis", employer: "Egis", adapter: "smartrecruiters", companyId: "EgisGroup" },
  { id: "archirodon", employer: "Archirodon", adapter: "smartrecruiters", companyId: "ArchirodonGroup" },
];
