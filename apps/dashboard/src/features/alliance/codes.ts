// Names for the codes get.al.info sends: `language` is a client localization
// key, `country` an ISO 3166-1 alpha-2 code. The column stores the raw code
// (0313) so a key the client adds later displays as itself instead of failing.
//
// LANGUAGES is read off the client dictionary
// (Assets_Main_DataTable_Localization_{English,Korean}_Dictionaries_Dialog_1,
// keys 390751–390783 and 391083). The Korean column is kept because the
// dictionary has it; the site is English (user decision 2026-11-08) and
// nothing renders it yet.

export interface CodeName {
  en: string;
  ko: string;
}

export const LANGUAGES: Readonly<Record<string, CodeName>> = {
  '390751': { en: 'All', ko: '모든 언어' },
  '390752': { en: 'English', ko: '영어' },
  '390753': { en: 'Spanish', ko: '스페인어' },
  '390754': { en: 'French', ko: '프랑스어' },
  '390755': { en: 'Portuguese', ko: '포르투갈어' },
  '390756': { en: 'German', ko: '독일어' },
  '390757': { en: 'Russian', ko: '러시아어' },
  '390758': { en: 'Korean', ko: '한국어' },
  '390759': { en: 'Chinese', ko: '중국어' },
  '390760': { en: 'Italian', ko: '이탈리아어' },
  '390761': { en: 'Czech', ko: '체코어' },
  '390762': { en: 'Danish', ko: '덴마크어' },
  '390763': { en: 'Greek', ko: '그리스어' },
  '390764': { en: 'Finnish', ko: '핀란드어' },
  '390765': { en: 'Hungarian', ko: '헝가리어' },
  '390766': { en: 'Japanese', ko: '일본어' },
  '390767': { en: 'Norwegian', ko: '노르웨이어' },
  '390768': { en: 'Dutch', ko: '네덜란드어' },
  '390769': { en: 'Polish', ko: '폴란드어' },
  '390770': { en: 'Romanian', ko: '로마니아어' },
  '390771': { en: 'Slovak', ko: '슬로바키아어' },
  '390772': { en: 'Swedish', ko: '스웨덴어' },
  '390773': { en: 'Turkish', ko: '튀르키예어' },
  '390774': { en: 'Catalan', ko: '카탈루냐어' },
  '390775': { en: 'Hebrew', ko: '히브리어' },
  '390777': { en: 'Malay', ko: '말레이시아어' },
  '390778': { en: 'Ukrainian', ko: '우크라이나어' },
  '390779': { en: 'Croatian', ko: '크로아티아어' },
  '390780': { en: 'Thai', ko: '태국어' },
  '390781': { en: 'Vietnamese', ko: '베트남어' },
  '390782': { en: 'Arabic', ko: '아라비아어' },
  '390783': { en: 'Indonesian', ko: '인도네시아어' },
  '391083': { en: 'Traditional Chinese', ko: '중국어 (번체)' },
};

// ISO 3166-1 alpha-2. Not the whole registry: the countries alliances on
// these servers plausibly set, by region. An unlisted code displays as itself.
export const COUNTRIES: Readonly<Record<string, CodeName>> = {
  AE: { en: 'United Arab Emirates', ko: '아랍에미리트' },
  AR: { en: 'Argentina', ko: '아르헨티나' },
  AT: { en: 'Austria', ko: '오스트리아' },
  AU: { en: 'Australia', ko: '오스트레일리아' },
  BE: { en: 'Belgium', ko: '벨기에' },
  BR: { en: 'Brazil', ko: '브라질' },
  CA: { en: 'Canada', ko: '캐나다' },
  CH: { en: 'Switzerland', ko: '스위스' },
  CL: { en: 'Chile', ko: '칠레' },
  CN: { en: 'China', ko: '중국' },
  CO: { en: 'Colombia', ko: '콜롬비아' },
  CZ: { en: 'Czechia', ko: '체코' },
  DE: { en: 'Germany', ko: '독일' },
  DK: { en: 'Denmark', ko: '덴마크' },
  EG: { en: 'Egypt', ko: '이집트' },
  ES: { en: 'Spain', ko: '스페인' },
  FI: { en: 'Finland', ko: '핀란드' },
  FR: { en: 'France', ko: '프랑스' },
  GB: { en: 'United Kingdom', ko: '영국' },
  GR: { en: 'Greece', ko: '그리스' },
  HK: { en: 'Hong Kong', ko: '홍콩' },
  HU: { en: 'Hungary', ko: '헝가리' },
  ID: { en: 'Indonesia', ko: '인도네시아' },
  IE: { en: 'Ireland', ko: '아일랜드' },
  IL: { en: 'Israel', ko: '이스라엘' },
  IN: { en: 'India', ko: '인도' },
  IQ: { en: 'Iraq', ko: '이라크' },
  IT: { en: 'Italy', ko: '이탈리아' },
  JP: { en: 'Japan', ko: '일본' },
  KR: { en: 'South Korea', ko: '대한민국' },
  KW: { en: 'Kuwait', ko: '쿠웨이트' },
  MA: { en: 'Morocco', ko: '모로코' },
  MO: { en: 'Macao', ko: '마카오' },
  MX: { en: 'Mexico', ko: '멕시코' },
  MY: { en: 'Malaysia', ko: '말레이시아' },
  NL: { en: 'Netherlands', ko: '네덜란드' },
  NO: { en: 'Norway', ko: '노르웨이' },
  NZ: { en: 'New Zealand', ko: '뉴질랜드' },
  PE: { en: 'Peru', ko: '페루' },
  PH: { en: 'Philippines', ko: '필리핀' },
  PL: { en: 'Poland', ko: '폴란드' },
  PT: { en: 'Portugal', ko: '포르투갈' },
  QA: { en: 'Qatar', ko: '카타르' },
  RO: { en: 'Romania', ko: '루마니아' },
  RU: { en: 'Russia', ko: '러시아' },
  SA: { en: 'Saudi Arabia', ko: '사우디아라비아' },
  SE: { en: 'Sweden', ko: '스웨덴' },
  SG: { en: 'Singapore', ko: '싱가포르' },
  TH: { en: 'Thailand', ko: '태국' },
  TR: { en: 'Türkiye', ko: '튀르키예' },
  TW: { en: 'Taiwan', ko: '타이완' },
  UA: { en: 'Ukraine', ko: '우크라이나' },
  US: { en: 'United States', ko: '미국' },
  VN: { en: 'Vietnam', ko: '베트남' },
  ZA: { en: 'South Africa', ko: '남아프리카 공화국' },
};

/** The English name for a client language key; the key itself when unknown. */
export function languageName(key: string | null): string | null {
  if (key === null) return null;
  return LANGUAGES[key]?.en ?? key;
}

/** The English name for an ISO country code; the code itself when unknown. */
export function countryName(code: string | null): string | null {
  if (code === null) return null;
  const upper = code.toUpperCase();
  return COUNTRIES[upper]?.en ?? upper;
}
