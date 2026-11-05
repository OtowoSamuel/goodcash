import { MIN_NET_USDT_REQUIRED } from './rate';

export type Language = 'en' | 'pcm' | 'ha' | 'yo' | 'ig';

const minUsdt = MIN_NET_USDT_REQUIRED.toFixed(2);

export interface Translations {
  appName: string;
  tagline: string;
  heroHeadlinePre: string;
  heroHeadlineItalic: string;
  heroHeadlinePost: string;
  heroSubtext: string;
  safetyBanner: string;
  claimUbi: string;
  cashOutNow: string;
  balanceLabel: string;
  readyToCashOut: string;
  accumulating: string;
  daysToCashOut: string;
  partnerMinNote: string;
  youGive: string;
  youGet: string;
  whatItCosts: string;
  whyExplanation: string;
  exitContributionNote: string;
  slippageLabel: string;
  priceImpactWarning: string;
  continueToNaira: string;
  verifiedContract: string;
}

export const translations: Record<Language, Translations> = {
  en: {
    appName: 'GoodCash',
    tagline: 'Non-Custodial Router v1.0',
    heroHeadlinePre: 'Cash out your GoodDollar',
    heroHeadlineItalic: 'instantly and',
    heroHeadlinePost: 'hassle-free',
    heroSubtext:
      'Direct on-chain routing from daily UBI (G$) to Celo USDT and Naira. Non-custodial, verified smart contracts, transparent 10% reserve contribution.',
    safetyBanner: 'Never share your seed phrase. GoodCash will never DM you first.',
    claimUbi: 'Claim Daily G$',
    cashOutNow: 'Cash Out G$',
    balanceLabel: 'Your GoodDollar Balance',
    readyToCashOut: 'Ready to cash out!',
    accumulating: `Accumulating to $${minUsdt} payout minimum`,
    daysToCashOut: 'Estimated days to cash-out',
    partnerMinNote: `Paycrest payouts require at least $${minUsdt} USDT after swap fees.`,
    youGive: 'You give',
    youGet: 'You get (at least)',
    whatItCosts: 'What it costs',
    whyExplanation: '10% protocol exit contribution to the GoodDollar reserve + network gas (<$0.001).',
    exitContributionNote: 'The 10% exit contribution is levied by the GoodDollar Reserve protocol to support ongoing UBI.',
    slippageLabel: 'Slippage Tolerance',
    priceImpactWarning: 'Price impact exceeds 10%. Swap is blocked to protect your funds.',
    continueToNaira: 'Continue to Naira Off-Ramp',
    verifiedContract: 'Verified Contract: 0xA433...c407',
  },
  pcm: {
    appName: 'GoodCash',
    tagline: 'Router wey dey secure v1.0',
    heroHeadlinePre: 'Change your GoodDollar to money',
    heroHeadlineItalic: 'sharp sharp and',
    heroHeadlinePost: 'no wahala',
    heroSubtext:
      'Send your daily GoodDollar straight to USDT and Naira for your account. You get full control of your money, everything clear.',
    safetyBanner: 'No ever give anybody your secret recovery phrase. GoodCash no go ever send you DM first.',
    claimUbi: 'Claim Today G$',
    cashOutNow: 'Cash Out Now',
    balanceLabel: 'Your GoodDollar Balance',
    readyToCashOut: 'You fit cash out now!',
    accumulating: `E dey gather reach $${minUsdt} payout minimum`,
    daysToCashOut: 'Days wey remain to cash out',
    partnerMinNote: `Paycrest need at least $${minUsdt} USDT after swap fees before dem fit send money enter your bank.`,
    youGive: 'You go give',
    youGet: 'You go get (at least)',
    whatItCosts: 'Wetyn e go cost',
    whyExplanation: '10% protocol contribution to GoodDollar reserve + small network gas.',
    exitContributionNote: 'Na GoodDollar Reserve dey take 10% so that UBI go continue for everybody.',
    slippageLabel: 'Slippage',
    priceImpactWarning: 'Price impact high pass 10%. We lock am make you no lose money.',
    continueToNaira: 'Send enter Naira Bank',
    verifiedContract: 'Verified Contract: 0xA433...c407',
  },
  ha: {
    appName: 'GoodCash',
    tagline: 'Tsarin Sauyi v1.0',
    heroHeadlinePre: 'Sauya GoodDollar dinka zuwa kudi',
    heroHeadlineItalic: 'nan take ba tare da',
    heroHeadlinePost: 'wahala ba',
    heroSubtext: 'Sauya G$ zuwa USDT da Naira kai tsaye a cikin asusunka cikin sauki da aminci.',
    safetyBanner: 'Kada ka taba ba da kalmomin sirrinka (seed phrase). GoodCash ba zai taba aiko maka sako ba.',
    claimUbi: 'Karbi G$ na Yau',
    cashOutNow: 'Cire Kudi',
    balanceLabel: 'Adadin GoodDollar dinka',
    readyToCashOut: 'A shirye kake ka cire kudi!',
    accumulating: `Ana tarawa zuwa mafi karancin $${minUsdt}`,
    daysToCashOut: 'Kwanakin da suka rage',
    partnerMinNote: `Paycrest yana bukatar a kalla $${minUsdt} USDT don tura kudi zuwa asusun banki.`,
    youGive: 'Abin da za ka bayar',
    youGet: 'Abin da za ka samu (a kalla)',
    whatItCosts: 'Kudin hidima',
    whyExplanation: 'Gudunmawar 10% zuwa GoodDollar Reserve da kudin gas na Celo.',
    exitContributionNote: 'Gudunmawar 10% na tallafawa ci gaban tsarin UBI na kowa da kowa.',
    slippageLabel: 'Kariyar Farashi (Slippage)',
    priceImpactWarning: 'Tasirin farashi ya haura 10%. An dakatar don kare kudinka.',
    continueToNaira: 'Ci gaba zuwa Naira',
    verifiedContract: 'Verified Contract: 0xA433...c407',
  },
  yo: {
    appName: 'GoodCash',
    tagline: 'Eto Ipamọ v1.0',
    heroHeadlinePre: 'Yipada GoodDollar rẹ si owo',
    heroHeadlineItalic: 'lesekese lai si',
    heroHeadlinePost: 'wahala kankan',
    heroSubtext: 'Yipada G$ rẹ taara si USDT ati Naira lori Celo lai si enikeni to le gba owo rẹ.',
    safetyBanner: 'Maṣe fi ọrọ asiri rẹ han ẹnikẹni. GoodCash kii yoo kọkọ fi ifiranṣẹ ranṣẹ si ọ lailai.',
    claimUbi: 'Gba G$ ti Oni',
    cashOutNow: 'Yọ Owo Jade',
    balanceLabel: 'Iye GoodDollar Rẹ',
    readyToCashOut: 'O ti ṣetan lati yọ owo!',
    accumulating: `O n ko jọ si iye to kere julọ $${minUsdt}`,
    daysToCashOut: 'Ọjọ melo lo ku',
    partnerMinNote: `Paycrest n beere fun o kere ju $${minUsdt} USDT lati fi ranṣẹ si ile ifowopamọ rẹ.`,
    youGive: 'Ohun ti o fi silẹ',
    youGet: 'Ohun ti o gba (o kere ju)',
    whatItCosts: 'Iye ti yoo na ọ',
    whyExplanation: '10% idasi si GoodDollar Reserve pẹlu iye kekere fun gas.',
    exitContributionNote: 'Idasi 10% jẹ fun eto GoodDollar Reserve lati rii daju pe UBI n tẹsiwaju.',
    slippageLabel: 'Aala Iyipada Farashi',
    priceImpactWarning: 'Ipa iye owo ti kọja 10%. A ti di lati daabobo owo rẹ.',
    continueToNaira: 'Tẹsiwaju si Naira',
    verifiedContract: 'Verified Contract: 0xA433...c407',
  },
  ig: {
    appName: 'GoodCash',
    tagline: 'Usoro Ntụgharị v1.0',
    heroHeadlinePre: 'Tụgharịa GoodDollar gị ka ọ bụrụ ego',
    heroHeadlineItalic: 'ngwa ngwa n\'enweghị',
    heroHeadlinePost: 'nsogbu ọ bụla',
    heroSubtext: 'Tụgharịa G$ gị gaa na USDT na Naira ozugbo n\'enweghị onye nwere ike ijide ego gị.',
    safetyBanner: 'Enyela onye ọ bụla mkpụrụokwu nzuzo gị. GoodCash agaghị ezigara gị ozi na mbụ.',
    claimUbi: 'Nata G$ nke Taa',
    cashOutNow: 'Wepụta Ego',
    balanceLabel: 'Ọnụego GoodDollar Gị',
    readyToCashOut: 'Ị dịla njikere iwepụta ego!',
    accumulating: `Na-achịkọta ruo $${minUsdt} kacha nta`,
    daysToCashOut: 'Ụbọchị fọdụrụ',
    partnerMinNote: `Paycrest chọrọ ma ọ dịkarịa ala $${minUsdt} USDT iji kwụọ ụgwọ n'ụlọ akụ.`,
    youGive: 'Ihe ị ga-enye',
    youGet: 'Ihe ị ga-enweta (opekempe)',
    whatItCosts: 'Ọnụ ego ọ ga-efu',
    whyExplanation: '10% onyinye protocol na GoodDollar Reserve tinyere ego gas Celo.',
    exitContributionNote: '10% a na-aga na GoodDollar Reserve iji hụ na UBI na-aga n\'ihu.',
    slippageLabel: 'Nchekwa Slippage',
    priceImpactWarning: 'Mmetụta ọnụahịa karịrị 10%. Akwụsịrị iji chebe ego gị.',
    continueToNaira: 'Gaa n\'ihu na Naira',
    verifiedContract: 'Verified Contract: 0xA433...c407',
  },
};
