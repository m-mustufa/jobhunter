export interface Employer {
  name: string;
  blurb: string;
}

export interface EmployerCategory {
  category: string;
  employers: Employer[];
}

// Reference list of major Abu Dhabi employers, for browsing only — not wired
// into automated search. Each gets a generated LinkedIn jobs-search link
// rather than a guessed career-page URL.
export const EMPLOYER_DIRECTORY: EmployerCategory[] = [
  {
    category: "Sovereign Wealth Funds & Government Investment Holdings",
    employers: [
      { name: "Abu Dhabi Investment Authority (ADIA)", blurb: "One of the world's largest sovereign wealth funds; global asset management" },
      { name: "Mubadala Investment Company", blurb: "Sovereign investor; sectors from energy and tech to healthcare and aerospace" },
      { name: "ADQ (Abu Dhabi Developmental Holding Company)", blurb: "Holding company with 90+ portfolio companies across strategic sectors" },
      { name: "Abu Dhabi Investment Council (ADIC)", blurb: "Investment arm under Mubadala managing government financial assets" },
      { name: "Emirates Investment Authority (EIA)", blurb: "Federal sovereign wealth fund based in Abu Dhabi" },
      { name: "Lunate", blurb: "Abu Dhabi–based global alternative asset manager" },
      { name: "International Holding Company (IHC)", blurb: "Abu Dhabi's largest listed conglomerate by market cap" },
      { name: "Alpha Dhabi Holding", blurb: "Diversified investment holding within the IHC ecosystem" },
      { name: "2PointZero / MGX", blurb: "AI, technology and advanced-industry investment platforms" },
      { name: "Abu Dhabi Fund for Development (ADFD)", blurb: "Sovereign development finance and foreign aid institution" },
    ],
  },
  {
    category: "Government Departments & Authorities (Executive Council)",
    employers: [
      { name: "Abu Dhabi Executive Office", blurb: "Central strategy and policy office of the Executive Council" },
      { name: "Executive Affairs Authority (EAA)", blurb: "Strategic policy advice to the Executive Council" },
      { name: "Department of Government Enablement (DGE)", blurb: "Government HR, digital and enablement (incl. former Digital Authority)" },
      { name: "Department of Finance (DoF)", blurb: "Manages the emirate's public finances and budget" },
      { name: "Abu Dhabi Department of Economic Development (ADDED)", blurb: "Economic regulation, licensing and business growth" },
      { name: "Department of Culture and Tourism (DCT Abu Dhabi)", blurb: "Culture, heritage and tourism development" },
      { name: "Department of Municipalities and Transport (DMT)", blurb: "Urban planning, municipalities and transport" },
      { name: "Department of Health (DoH)", blurb: "Health sector regulator for the emirate" },
      { name: "Department of Education and Knowledge (ADEK)", blurb: "Regulates schools, higher education and early education" },
      { name: "Department of Energy (DoE)", blurb: "Regulates the electricity, water and energy sector" },
      { name: "Department of Community Development (DCD)", blurb: "Social policy, licensing of social services" },
      { name: "Abu Dhabi Judicial Department (ADJD)", blurb: "Courts, prosecution and justice services" },
      { name: "Abu Dhabi Accountability Authority (ADAA)", blurb: "Government audit and financial oversight" },
      { name: "Abu Dhabi Police (Ministry of Interior)", blurb: "Policing and public security" },
      { name: "Environment Agency – Abu Dhabi (EAD)", blurb: "Environmental protection and biodiversity" },
      { name: "Abu Dhabi Agriculture & Food Safety Authority (ADAFSA)", blurb: "Food safety, agriculture and biosecurity" },
      { name: "Abu Dhabi Quality and Conformity Council (QCC)", blurb: "Standards, metrology and conformity" },
      { name: "Integrated Transport Centre / Abu Dhabi Mobility (ITC)", blurb: "Public transport, roads and mobility" },
      { name: "Statistics Centre – Abu Dhabi (SCAD)", blurb: "Official statistics authority" },
      { name: "Abu Dhabi Housing Authority (ADHA)", blurb: "Citizen housing programs" },
      { name: "Abu Dhabi Pension Fund", blurb: "Pensions and end-of-service for Abu Dhabi nationals" },
      { name: "Abu Dhabi Civil Defence Authority", blurb: "Fire, rescue and emergency services" },
      { name: "TAMM", blurb: "Unified Abu Dhabi government services platform" },
      { name: "Abu Dhabi City / Al Ain City / Al Dhafra Region Municipalities", blurb: "Regional municipal services" },
    ],
  },
  {
    category: "Financial Free Zone, Markets & Regulators",
    employers: [
      { name: "Abu Dhabi Global Market (ADGM)", blurb: "International financial centre and free zone" },
      { name: "Abu Dhabi Securities Exchange (ADX)", blurb: "The emirate's stock exchange" },
      { name: "Abu Dhabi Investment Office (ADIO)", blurb: "Investment promotion and investor support" },
    ],
  },
  {
    category: "Energy, Oil, Utilities & Industry",
    employers: [
      { name: "ADNOC (Abu Dhabi National Oil Company)", blurb: "National oil & gas group and its listed units" },
      { name: "ADNOC Gas / ADNOC Drilling / ADNOC Distribution / ADNOC L&S", blurb: "Major listed ADNOC subsidiaries" },
      { name: "Borouge", blurb: "Petrochemicals (ADNOC / Borealis JV)" },
      { name: "TAQA (Abu Dhabi National Energy Company)", blurb: "Power, water and utilities; global operations" },
      { name: "Masdar (Abu Dhabi Future Energy Company)", blurb: "Renewable energy and clean-tech developer" },
      { name: "Emirates Nuclear Energy Company (ENEC) / Nawah", blurb: "Barakah nuclear plant operator" },
      { name: "Emirates Water and Electricity Company (EWEC)", blurb: "Water and electricity procurement and generation" },
      { name: "Abu Dhabi Distribution Company (ADDC) / Al Ain Distribution / Transco", blurb: "Utility distribution and transmission" },
      { name: "Emsteel (formerly Emirates Steel Arkan)", blurb: "Steel and building-materials manufacturer" },
    ],
  },
  {
    category: "Aviation, Transport & Logistics",
    employers: [
      { name: "Etihad Airways", blurb: "National airline of the UAE, based in Abu Dhabi" },
      { name: "Abu Dhabi Airports", blurb: "Operator of Zayed International Airport and others" },
      { name: "AD Ports Group (Abu Dhabi Ports)", blurb: "Ports, logistics, economic cities and maritime" },
      { name: "Etihad Rail", blurb: "UAE national railway network operator" },
      { name: "Wizz Air Abu Dhabi", blurb: "Low-cost carrier joint venture" },
      { name: "Abu Dhabi Aviation", blurb: "Helicopter and fixed-wing aviation services" },
      { name: "SANAD", blurb: "Aerospace engineering and MRO (Mubadala)" },
      { name: "Global Aerospace Logistics (GAL)", blurb: "Defense and aerospace support services" },
    ],
  },
  {
    category: "Banking, Finance & Insurance",
    employers: [
      { name: "First Abu Dhabi Bank (FAB)", blurb: "Largest bank in the UAE" },
      { name: "Abu Dhabi Commercial Bank (ADCB)", blurb: "Major commercial bank" },
      { name: "Abu Dhabi Islamic Bank (ADIB)", blurb: "Leading Islamic bank" },
      { name: "Al Hilal Bank", blurb: "Digital-focused Islamic bank (ADCB group)" },
      { name: "Wio Bank", blurb: "Digital banking platform" },
      { name: "Abu Dhabi National Insurance Company (ADNIC)", blurb: "Insurance and reinsurance" },
      { name: "Daman (National Health Insurance Company)", blurb: "Health insurance provider" },
    ],
  },
  {
    category: "Real Estate, Construction & Destinations",
    employers: [
      { name: "Aldar Properties", blurb: "Leading UAE real-estate developer and manager" },
      { name: "Modon Properties", blurb: "Master developer (Reem Island and mega-projects)" },
      { name: "IMKAN Properties", blurb: "Real-estate developer" },
      { name: "Miral", blurb: "Developer of Yas Island leisure and entertainment" },
      { name: "Farah Experiences", blurb: "Operates Ferrari World, Yas Waterworld, Warner Bros. World" },
      { name: "Bloom Holding", blurb: "Real estate and education developer" },
      { name: "Q Holding / Reem Investments", blurb: "Real estate and investment developers" },
      { name: "Trojan Holding", blurb: "Construction and contracting (Alpha Dhabi)" },
      { name: "Abu Dhabi National Exhibitions Company (ADNEC Group)", blurb: "Venues, events and hospitality" },
    ],
  },
  {
    category: "Technology, AI & Innovation",
    employers: [
      { name: "G42", blurb: "Leading AI and cloud-computing group" },
      { name: "Core42", blurb: "Cloud, AI infrastructure and digital services (G42)" },
      { name: "Presight", blurb: "Big-data analytics and AI (listed)" },
      { name: "Space42", blurb: "Space, satellite and geospatial (Yahsat + Bayanat)" },
      { name: "Hub71", blurb: "Global tech startup ecosystem" },
      { name: "Technology Innovation Institute (TII)", blurb: "Applied research (AI, quantum, cryptography, more)" },
      { name: "e& (formerly Etisalat)", blurb: "Telecom and technology group, HQ Abu Dhabi" },
    ],
  },
  {
    category: "Healthcare & Pharma",
    employers: [
      { name: "PureHealth", blurb: "Largest healthcare group in the region (ADQ)" },
      { name: "SEHA (Abu Dhabi Health Services Company)", blurb: "Public hospitals and clinics network" },
      { name: "M42", blurb: "Tech-enabled health (Mubadala Health + G42 Healthcare)" },
      { name: "Cleveland Clinic Abu Dhabi", blurb: "Multispecialty hospital (M42)" },
      { name: "Burjeel Holdings", blurb: "Private hospitals and medical centres" },
      { name: "NMC Health", blurb: "Healthcare provider network" },
    ],
  },
  {
    category: "Defense, Aerospace & Advanced Industry",
    employers: [
      { name: "EDGE Group", blurb: "One of the world's leading defense and technology groups" },
      { name: "Tawazun Council", blurb: "Defense and security acquisitions and industrial development" },
      { name: "Strata Manufacturing", blurb: "Advanced aerostructures manufacturer (Mubadala)" },
    ],
  },
  {
    category: "Food, Agriculture & Retail",
    employers: [
      { name: "Agthia Group", blurb: "Food and beverage manufacturer (ADQ)" },
      { name: "Al Dahra", blurb: "Global agribusiness and food security" },
      { name: "Silal", blurb: "Food security and agri-tech (ADQ)" },
    ],
  },
  {
    category: "Media, Culture, Tourism & Sports",
    employers: [
      { name: "Abu Dhabi Media Network (ADMN)", blurb: "State broadcaster and media group" },
      { name: "Creative Media Authority / twofour54", blurb: "Media zone and content industry hub" },
      { name: "Louvre Abu Dhabi & Saadiyat Cultural District", blurb: "Museums and cultural institutions" },
      { name: "Abu Dhabi Sports Council", blurb: "Sports development and events" },
    ],
  },
  {
    category: "Education & Research (Universities)",
    employers: [
      { name: "Khalifa University", blurb: "Leading science and technology university" },
      { name: "Mohamed bin Zayed University of Artificial Intelligence (MBZUAI)", blurb: "Graduate AI research university" },
      { name: "Zayed University", blurb: "National university with an Abu Dhabi campus" },
      { name: "United Arab Emirates University (Al Ain)", blurb: "The UAE's flagship national university" },
      { name: "New York University Abu Dhabi (NYUAD)", blurb: "Research liberal-arts university" },
      { name: "Sorbonne University Abu Dhabi", blurb: "French-model comprehensive university" },
    ],
  },
];

export function linkedInSearchUrl(employerName: string) {
  const cleanName = employerName.split("(")[0].split("/")[0].trim();
  const params = new URLSearchParams({
    keywords: cleanName,
    location: "Abu Dhabi, United Arab Emirates",
  });
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}
