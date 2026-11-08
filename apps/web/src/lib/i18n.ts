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

  // Step 2b keys (English-only; other languages fall back via getTranslations)
  navHome: string;
  navCashOut: string;
  navHistory: string;
  connectWallet: string;
  connectedWallet: string;
  disconnect: string;
  browserOnly: string;
  howItWorks: string;
  howItWorksStep1: string;
  howItWorksStep2: string;
  howItWorksStep3: string;
  whatItCostsPanel: string;
  whatItCostsExplanation: string;
  staySafe: string;
  staySafeText: string;
  routeTitle: string;
  routeExplanation: string;
  details: string;
  goodToKnowTitle: string;
  goodToKnowText: string;
  yourTotals: string;
  totalCashOuts: string;
  totalGSwapped: string;
  totalNairaReceived: string;
  whatStatusesMean: string;
  statusOnItsWayExplanation: string;
  statusPaidExplanation: string;
  receiptsTitle: string;
  receiptsExplanation: string;
  footerText: string;
  contractLinkText: string;
  goodDollarLinkText: string;
  paycrestLinkText: string;
  privacyLinkText: string;
  privacyTitle: string;
  privacyText: string;

  // Step 3 keys (English-only; other languages fall back via getTranslations)
  yourBalance: string;
  aboutNairaAfterFees: string;
  gToGo: string;
  readyToCashOutShort: string;
  firstPayout: string;
  minimumCashOutAbout: string;
  lastCashOut: string;
  todayClaim: string;
  availableToClaimNow: string;
  claimTodayG: string;
  comeBackLater: string;
  nextClaimIn: string;
  verificationNeeded: string;
  verifyAtGoodDollar: string;
  couldNotLoadClaim: string;
  retry: string;
  cashOutOpensAt: string;
  cashOut: string;
  nairaUnavailable: string;
  claimTitle: string;
  claimed: string;
  backToHome: string;

  // Step 4a keys (English-only; other languages fall back via getTranslations)
  youGiveG: string;
  youReceiveAbout: string;
  atLeastUsdt: string;
  priceProtection: string;
  priceProtectionExplanation: string;
  bankDetails: string;
  bankLabel: string;
  selectBank: string;
  loadingBanks: string;
  accountNumberLabel: string;
  accountNumberPlaceholder: string;
  accountNameLabel: string;
  verifyingWithPaycrest: string;
  enterTenDigitAccount: string;
  confirmAccountName: string;
  exitContribution: string;
  whyTheTenPercent: string;
  slippageShort: string;
  route: string;
  routeReserveToUsdt: string;
  deadline: string;
  deadlineSeconds: string;
  quoteRefreshesIn: string;
  gAmountLabel: string;
  maxButton: string;
  reviewCashOut: string;
  rateUnavailableTryAgain: string;
  estimateFinalAmountNote: string;

  // Step 4b keys (English-only; other languages fall back via getTranslations)
  stepReview: string;
  stepSwap: string;
  stepOrder: string;
  stepDone: string;
  reviewLabel: string;
  confirmButton: string;
  confirming: string;
  swapAlreadyConfirmed: string;
  swapFailed: string;
  retryPayout: string;
  retryingPayout: string;
  refreshQuote: string;

  // Step 5 keys (English-only; other languages fall back via getTranslations)
  filterAll: string;
  filterOnItsWay: string;
  filterPaid: string;
  statusPaid: string;
  statusOnItsWay: string;
  statusUnknown: string;
  receipt: string;
  noCashOutsYet: string;
  noMatchingTransactions: string;

  // Step 8 keys (English-only; other languages fall back via getTranslations)
  nairaDelivered: string;
  paidToYourBank: string;
  viewTransactionReceipt: string;
  doneButton: string;

  // Step 10 keys (English-only; other languages fall back via getTranslations)
  miniPayBlockedTitle: string;
  miniPayBlockedBody1: string;
  miniPayBlockedBody2: string;
  copyGoodCashLink: string;
  linkCopied: string;
  openInBrowser: string;
  loadingRate: string;
  loadingSwap: string;
  errorRateUnavailable: string;
  errorSwapFailed: string;
  errorNetworkFailure: string;
  errorTransactionRejected: string;
  retryAction: string;
}
/** Merge English defaults with the selected language so all keys are present. */
export function getTranslations(lang: Language): Translations {
  return { ...translations.en, ...translations[lang] } as Translations;
}

export const translations: Record<Language, Partial<Translations>> = {
  en: {
    appName: 'GoodCash',
    tagline: 'Non-Custodial Router v1.0',
    heroHeadlinePre: 'Cash out your GoodDollar',
    heroHeadlineItalic: 'instantly and',
    heroHeadlinePost: 'hassle-free',
    heroSubtext:
      'Direct on-chain routing from daily UBI (G$) to Naira in your bank. Non-custodial, verified smart contracts, transparent 10% reserve contribution.',
    safetyBanner: 'Never share your seed phrase. GoodCash will never message you first.',
    claimUbi: 'Claim Daily G$',
    cashOutNow: 'Cash Out G$',
    balanceLabel: 'Your GoodDollar Balance',
    readyToCashOut: 'Ready to cash out!',
    accumulating: `Accumulating to $${minUsdt} payout minimum`,
    daysToCashOut: 'Estimated days to cash-out',
    partnerMinNote: `Payouts need at least about $${minUsdt} worth of G$ after fees.`,
    youGive: 'You give',
    youGet: 'You get (at least)',
    whatItCosts: 'What it costs',
    whyExplanation: '10% protocol exit contribution to the GoodDollar reserve + network gas (<$0.001).',
    exitContributionNote: 'The 10% exit contribution is levied by the GoodDollar Reserve protocol to support ongoing UBI.',
    slippageLabel: 'Slippage Tolerance',
    priceImpactWarning: 'Price impact exceeds 10%. Swap is blocked to protect your funds.',
    continueToNaira: 'Continue to Naira Off-Ramp',
    verifiedContract: 'Verified Contract: 0xA433...c407',

    navHome: 'Home',
    navCashOut: 'Cash out',
    navHistory: 'History',
    connectWallet: 'Connect wallet',
    connectedWallet: 'Connected wallet',
    disconnect: 'Disconnect',
    browserOnly: 'Browser only',
    howItWorks: 'How it works',
    howItWorksStep1: 'Convert your G$ to dollars on Celo.',
    howItWorksStep2: 'We send it to a payout partner.',
    howItWorksStep3: 'Naira lands in your bank account.',
    whatItCostsPanel: 'What it costs',
    whatItCostsExplanation: '10% goes to the GoodDollar reserve. You see every number before you confirm.',
    staySafe: 'Stay safe',
    staySafeText: 'Never share your seed phrase. GoodCash will never message you first.',
    routeTitle: 'How it moves',
    routeExplanation: 'Your G$ is converted to dollars, then our payout partner pays naira into your bank.',
    details: 'Details',
    goodToKnowTitle: 'Good to know',
    goodToKnowText: `Naira payouts need at least about $${minUsdt} worth of G$. Arrival time depends on the payout partner.`,
    yourTotals: 'Your totals',
    totalCashOuts: 'Cash outs',
    totalGSwapped: 'G$ cashed out',
    totalNairaReceived: 'Naira received so far',
    whatStatusesMean: 'What the statuses mean',
    statusOnItsWayExplanation: 'On its way: swapped, waiting for the payout partner.',
    statusPaidExplanation: 'Paid: naira sent to your bank account.',
    receiptsTitle: 'Receipts',
    receiptsExplanation: 'Every cash out has an on-chain receipt you can check on the Celo explorer.',
    footerText: 'GoodCash © 2026 · Your money stays in your wallet',
    contractLinkText: 'Contract',
    goodDollarLinkText: 'GoodDollar',
    paycrestLinkText: 'Paycrest',
    privacyLinkText: 'Privacy',
    privacyTitle: 'Privacy',
    privacyText: 'Wallet addresses are pseudonymous personal data. GoodCash analytics are wallet-level only and never include bank details, names, phone numbers, or raw partner responses. Swaps happen on Celo; the naira payout is handled by our payout partner.',

    yourBalance: 'Your balance',
    aboutNairaAfterFees: 'about {naira} after fees',
    gToGo: '{n} G$ to go',
    readyToCashOutShort: 'Ready to cash out',
    firstPayout: 'First payout',
    minimumCashOutAbout: 'Minimum cash out is about {g} G$ ({naira}).',
    lastCashOut: 'Last cash out',
    todayClaim: "Today's claim",
    availableToClaimNow: 'Available to claim now',
    claimTodayG: "Claim today's G$",
    comeBackLater: 'Come back later',
    nextClaimIn: 'Next claim in {time}',
    verificationNeeded: 'Verification needed',
    verifyAtGoodDollar: 'Verify at wallet.gooddollar.org ↗',
    couldNotLoadClaim: "Couldn't load your claim. Try again.",
    retry: 'Retry',
    cashOutOpensAt: 'Cash out opens at {n} G$',
    cashOut: 'Cash out',
    nairaUnavailable: '₦ -',
    claimTitle: 'Claim',
    claimed: 'Claimed',
    backToHome: 'Back to home',
    youGiveG: 'You give',
    youReceiveAbout: 'You receive about',
    atLeastUsdt: 'At least {usdt} USDT',
    priceProtection: 'Price protection',
    priceProtectionExplanation: 'Protects you if the price drops while your transaction is pending.',
    bankDetails: 'Bank details',
    bankLabel: 'Bank',
    selectBank: 'Select bank',
    loadingBanks: 'Loading banks…',
    accountNumberLabel: 'Account number',
    accountNumberPlaceholder: '10-digit account number',
    accountNameLabel: 'Account name',
    verifyingWithPaycrest: 'Checking your account…',
    enterTenDigitAccount: 'Enter a 10-digit account number',
    confirmAccountName: 'I confirm this is my account name',
    exitContribution: 'Exit contribution',
    whyTheTenPercent: 'Why the 10%?',
    slippageShort: 'Slippage',
    route: 'Route',
    routeReserveToUsdt: 'Reserve → USDT',
    deadline: 'Deadline',
    deadlineSeconds: '300s',
    quoteRefreshesIn: 'Quote refreshes in {seconds}s',
    gAmountLabel: 'G$ amount',
    maxButton: 'MAX',
    reviewCashOut: 'Review cash out',
    rateUnavailableTryAgain: 'Rate unavailable, try again',
    estimateFinalAmountNote: 'Estimate. Final amount is set by our payout partner when the order is created.',
    stepReview: 'Review',
    stepSwap: 'Convert',
    stepOrder: 'Payment',
    stepDone: 'Done',
    reviewLabel: 'Review',
    confirmButton: 'Confirm',
    confirming: 'Confirming...',
    swapAlreadyConfirmed: 'Already confirmed',
    swapFailed: 'Swap failed',
    retryPayout: 'Try the payout again',
    retryingPayout: 'Retrying payout…',
    refreshQuote: 'Refresh quote',
    filterAll: 'All',
    filterOnItsWay: 'On its way',
    filterPaid: 'Paid',
    statusPaid: 'Paid',
    statusOnItsWay: 'On its way',
    statusUnknown: 'Checking status',
    receipt: 'Receipt',

    // Step 8 keys
    nairaDelivered: 'Naira Delivered!',
    paidToYourBank: 'paid to your bank',
    viewTransactionReceipt: 'Receipt',
    doneButton: 'Done',

    noCashOutsYet: 'No cash outs yet. Your first one will show up here.',
    noMatchingTransactions: 'No transactions match this filter.',

    // Step 10 keys (English-only; other languages fall back via getTranslations)
    miniPayBlockedTitle: 'MiniPay does not support G$',
    miniPayBlockedBody1: 'GoodCash needs a wallet that can hold G$ and complete the claim flow. MiniPay does not support G$ and cannot be used for this product.',
    miniPayBlockedBody2: 'We do not connect the MiniPay wallet, do not show your address, and we do not run any claim or swap flow inside MiniPay.',
    copyGoodCashLink: 'Copy GoodCash link',
    linkCopied: 'Link copied',
    openInBrowser: 'Open in browser',
    loadingRate: 'Loading rate…',
    loadingSwap: 'Executing swap…',
    errorRateUnavailable: 'Rate unavailable. Try again.',
    errorSwapFailed: 'Swap failed. Try again.',
    errorNetworkFailure: 'Network failure. Check your connection.',
    errorTransactionRejected: 'Transaction rejected.',
    retryAction: 'Retry',
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
