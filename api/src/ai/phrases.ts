import { formatInr } from '../engine/format.js';
import { LEAK_LABELS } from '../engine/leaks.js';
import type { LeakCause } from '../engine/types.js';
import type { OverrideKey } from '../schema/orders.js';
import type { Lang } from './templates.js';

// Deterministic template text for the v2 AI features (Ask Profyn, Fix Advisor extras, Digest) in English, Hindi and
// Telugu. Numbers are passed in from engine JSON and printed in Latin digits; only the words change by language.

export const num = (n: number) => n.toLocaleString('en-IN');

export interface Phrases {
  unknown: string;
  orders(n: number): string;
  leakLabel(cause: LeakCause): string;
  // Ask Profyn
  leaksTop(label: string, orders: string, lost: string): string;
  leaksNext(label: string, lost: string): string;
  leaksNone: string;
  leakCause(label: string, orders: string, lost: string, ids: string): string;
  leaksMonth(month: string, total: string): string;
  monthOne(month: string, orders: string, net: string, c: string, pct: number): string;
  monthBestWorst(best: string, bestInr: string, worst: string, worstInr: string): string;
  productWorst(month: string | null, product: string, c: string, orders: string): string;
  productLeast(month: string | null, product: string, c: string, orders: string): string;
  productBest(month: string | null, product: string, c: string, orders: string): string;
  productOne(product: string, orders: string, net: string, c: string): string;
  channelOne(channel: string, orders: string, net: string, c: string, ads: string, share: number): string;
  channelWorst(channel: string, c: string, orders: string): string;
  scenarioOverride(change: string, base: string, scen: string, delta: string): string;
  scenarioCandidate(label: string, delta: string, orders: string): string;
  noData: string;
  unsafe: string;
  override(key: OverrideKey | 'assume_unknown_refund', value: unknown): string;
  // Fix Advisor
  recordFacts: string;
  assumeUnknown: string;
  shippingChange(amount: string): string;
  testRecordFacts(orders: string): string;
  stopRecordFacts: string;
  testShipping(amount: string): string;
  stopShipping: string;
  noGain(label: string, delta: string): string;
  // Digest
  titles: { changed: string; leaked: string; decided: string; check: string };
  changedPrev(month: string, orders: string, net: string, c: string, prev: string, prevC: string): string;
  changedOne(month: string, orders: string, net: string, c: string): string;
  changedNone: string;
  leaked(label: string, orders: string, lost: string): string;
  leakedMore(label: string, lost: string): string;
  leakedNone: string;
  decidedSome(n: number, label: string, owner: string, delta: string): string;
  decidedNone(label: string, delta: string): string;
  checkDecision(date: string, label: string, target: string): string;
}

const en: Phrases = {
  unknown: 'unknown',
  orders: (n) => `${num(n)} order${n === 1 ? '' : 's'}`,
  leakLabel: (c) => LEAK_LABELS[c],
  leaksTop: (label, orders, lost) => `The biggest leak is ${label}: ${orders}, ${lost} lost.`,
  leaksNext: (label, lost) => ` Next: ${label} (${lost}).`,
  leaksNone: 'No leaks: no order has a negative or unknown contribution.',
  leakCause: (label, orders, lost, ids) => `${label}: ${orders}, ${lost} lost. Examples: ${ids}.`,
  leaksMonth: (month, total) => ` In ${month}, leaks cost ${total} in total.`,
  monthOne: (month, orders, net, c, pct) => `In ${month}, ${orders} brought ${net} net sales and ${c} contribution (${pct}% of net sales).`,
  monthBestWorst: (best, bestInr, worst, worstInr) => `Best month for contribution: ${best} (${bestInr}). Weakest: ${worst} (${worstInr}).`,
  productWorst: (m, p, c, o) => `${m ? `In ${m}, ` : ''}${p} lost most: ${c} contribution on ${o}.`,
  productLeast: (m, p, c, o) => `${m ? `In ${m}, ` : ''}${p} earned least: ${c} contribution on ${o}.`,
  productBest: (m, p, c, o) => `${m ? `In ${m}, ` : ''}${p} earned most: ${c} contribution on ${o}.`,
  productOne: (p, o, net, c) => `${p}: ${o}, ${net} net sales, ${c} contribution.`,
  channelOne: (ch, o, net, c, ads, share) => `${ch}: ${o}, ${net} net sales and ${c} contribution after ads; ads were ${ads} (${share}% of net sales).`,
  channelWorst: (ch, c, o) => `Weakest channel: ${ch} with ${c} contribution on ${o}.`,
  scenarioOverride: (change, base, scen, delta) => `${change}: contribution moves from ${base} to ${scen} (${delta}).`,
  scenarioCandidate: (label, delta, orders) => `${label}: contribution changes by ${delta} across ${orders} (engine estimate).`,
  noData: 'No data for that question.',
  unsafe: 'AI could not phrase this safely',
  override: (k, v) =>
    ({
      return_rate_pct: `Return rate ${v}%`,
      recovery_pct: `Recovery ${v}% of product cost`,
      shipping_inr: `Shipping ${formatInr(v as number)} per order`,
      refund_policy: v === 'full' ? 'Full refunds' : 'Partial refunds',
      ads_per_order: `Ads ${formatInr(v as number)} per order`,
      assume_unknown_refund: 'Missing refunds assumed full',
    })[k],
  recordFacts: 'Record the missing refund facts',
  assumeUnknown: 'Assume missing refunds were full and nothing was recovered',
  shippingChange: (a) => `Negotiate shipping to ${a} per order`,
  testRecordFacts: (o) => `For 30 days, record the refund amount, recovered stock value and return cost on every return; re-run the analysis once the ${o} with missing facts are complete.`,
  stopRecordFacts: 'Stop when every returned order has all three facts recorded.',
  testShipping: (a) => `For 30 days, ship at ${a} per order and track delivery time and contribution per order.`,
  stopShipping: 'Stop if late deliveries or complaints rise for two weeks in a row.',
  noGain: (label, delta) => `${label} does not improve contribution under these assumptions (${delta}).`,
  titles: { changed: 'What changed', leaked: 'Where money leaked', decided: 'What was decided', check: 'What to check in 30 days' },
  changedPrev: (m, o, net, c, prev, prevC) => `In ${m}, ${o} brought ${net} net sales and ${c} contribution, against ${prevC} in ${prev}.`,
  changedOne: (m, o, net, c) => `In ${m}, ${o} brought ${net} net sales and ${c} contribution.`,
  changedNone: 'There is no month to compare yet.',
  leaked: (label, o, lost) => `Most money leaked through ${label}: ${o}, ${lost}.`,
  leakedMore: (label, lost) => ` Then ${label} (${lost}).`,
  leakedNone: 'No leaks in this period.',
  decidedSome: (n, label, owner, delta) => `${n} decision${n === 1 ? '' : 's'} saved. Latest: ${label}, owner ${owner}, expected impact ${delta}.`,
  decidedNone: (label, delta) => `No decision saved yet. The engine's top fix is ${label} (${delta}).`,
  checkDecision: (date, label, target) => `On ${date}, check whether contribution reached ${target} after ${label}.`,
};

const HI_LEAKS: Record<LeakCause, string> = {
  refund_unknown: 'रिफ़ंड या रिकवरी तथ्य गायब (अज्ञात)',
  full_return_partial_recovery: 'पूरा रिटर्न, आंशिक रिकवरी',
  discount_exceeds_margin: 'छूट बची रकम से ज़्यादा',
  fees_exceed_margin: 'शिपिंग और शुल्क बची रकम से ज़्यादा',
  other_negative: 'रिटर्न, लागत वापस नहीं मिली',
};

const hi: Phrases = {
  unknown: 'अज्ञात',
  orders: (n) => `${num(n)} ऑर्डर`,
  leakLabel: (c) => HI_LEAKS[c],
  leaksTop: (label, orders, lost) => `सबसे बड़ा लीक ${label} है: ${orders}, ${lost} का नुकसान।`,
  leaksNext: (label, lost) => ` उसके बाद: ${label} (${lost})।`,
  leaksNone: 'कोई लीक नहीं: किसी ऑर्डर का योगदान नकारात्मक या अज्ञात नहीं है।',
  leakCause: (label, orders, lost, ids) => `${label}: ${orders}, ${lost} का नुकसान। उदाहरण: ${ids}।`,
  leaksMonth: (month, total) => ` ${month} में लीक से कुल ${total} का नुकसान हुआ।`,
  monthOne: (month, orders, net, c, pct) => `${month} में ${orders} से ${net} शुद्ध बिक्री और ${c} योगदान मिला (शुद्ध बिक्री का ${pct}%)।`,
  monthBestWorst: (best, bestInr, worst, worstInr) => `योगदान में सबसे अच्छा महीना ${best} (${bestInr}) रहा, सबसे कमज़ोर ${worst} (${worstInr})।`,
  productWorst: (m, p, c, o) => `${m ? `${m} में ` : ''}${p} को सबसे ज़्यादा नुकसान हुआ: ${o} पर ${c} योगदान।`,
  productLeast: (m, p, c, o) => `${m ? `${m} में ` : ''}${p} का योगदान सबसे कम रहा: ${o} पर ${c}।`,
  productBest: (m, p, c, o) => `${m ? `${m} में ` : ''}${p} का योगदान सबसे ज़्यादा रहा: ${o} पर ${c}।`,
  productOne: (p, o, net, c) => `${p}: ${o}, ${net} शुद्ध बिक्री, ${c} योगदान।`,
  channelOne: (ch, o, net, c, ads, share) => `${ch}: ${o}, ${net} शुद्ध बिक्री और विज्ञापन के बाद ${c} योगदान; विज्ञापन ${ads} रहा (शुद्ध बिक्री का ${share}%)।`,
  channelWorst: (ch, c, o) => `सबसे कमज़ोर चैनल ${ch} है: ${o} पर ${c} योगदान।`,
  scenarioOverride: (change, base, scen, delta) => `${change}: योगदान ${base} से ${scen} हो जाता है (${delta})।`,
  scenarioCandidate: (label, delta, orders) => `${label}: ${orders} पर योगदान ${delta} बदलता है (इंजन का अनुमान)।`,
  noData: 'इस सवाल के लिए डेटा नहीं मिला।',
  unsafe: 'AI इसे सुरक्षित रूप से नहीं लिख सका; इंजन की तालिका देखें।',
  override: (k, v) =>
    ({
      return_rate_pct: `रिटर्न दर ${v}%`,
      recovery_pct: `रिकवरी उत्पाद लागत का ${v}%`,
      shipping_inr: `शिपिंग ${formatInr(v as number)} प्रति ऑर्डर`,
      refund_policy: v === 'full' ? 'पूरा रिफ़ंड' : 'आंशिक रिफ़ंड',
      ads_per_order: `विज्ञापन ${formatInr(v as number)} प्रति ऑर्डर`,
      assume_unknown_refund: 'गायब रिफ़ंड पूरे माने गए',
    })[k],
  recordFacts: 'गायब रिफ़ंड तथ्य दर्ज करें',
  assumeUnknown: 'मान लें कि गायब रिफ़ंड पूरे थे और कुछ वापस नहीं मिला',
  shippingChange: (a) => `शिपिंग ${a} प्रति ऑर्डर पर तय करें`,
  testRecordFacts: (o) => `30 दिनों तक हर रिटर्न पर रिफ़ंड राशि, वापस मिले स्टॉक का मूल्य और रिटर्न लागत दर्ज करें; तथ्यों के बिना वाले ${o} पूरे होते ही विश्लेषण फिर चलाएँ।`,
  stopRecordFacts: 'जब हर लौटे ऑर्डर के तीनों तथ्य दर्ज हो जाएँ, तब रोकें।',
  testShipping: (a) => `30 दिनों तक ${a} प्रति ऑर्डर की दर पर भेजें और डिलीवरी समय व प्रति ऑर्डर योगदान देखें।`,
  stopShipping: 'अगर लगातार दो हफ़्ते देर से डिलीवरी या शिकायतें बढ़ें, तो रोकें।',
  noGain: (label, delta) => `${label} इन मान्यताओं में योगदान नहीं बढ़ाता (${delta})।`,
  titles: { changed: 'क्या बदला', leaked: 'पैसा कहाँ लीक हुआ', decided: 'क्या तय हुआ', check: '30 दिनों में क्या जाँचें' },
  changedPrev: (m, o, net, c, prev, prevC) => `${m} में ${o} से ${net} शुद्ध बिक्री और ${c} योगदान मिला; ${prev} में योगदान ${prevC} था।`,
  changedOne: (m, o, net, c) => `${m} में ${o} से ${net} शुद्ध बिक्री और ${c} योगदान मिला।`,
  changedNone: 'तुलना के लिए अभी कोई महीना नहीं है।',
  leaked: (label, o, lost) => `सबसे ज़्यादा पैसा ${label} से गया: ${o}, ${lost}।`,
  leakedMore: (label, lost) => ` फिर ${label} (${lost})।`,
  leakedNone: 'इस अवधि में कोई लीक नहीं मिला।',
  decidedSome: (n, label, owner, delta) => `${n} निर्णय सहेजे गए। नवीनतम: ${label}, ज़िम्मेदार ${owner}, अपेक्षित असर ${delta}।`,
  decidedNone: (label, delta) => `अभी कोई निर्णय सहेजा नहीं गया। इंजन का सबसे अच्छा सुधार: ${label} (${delta})।`,
  checkDecision: (date, label, target) => `${date} को जाँचें कि ${label} के बाद योगदान ${target} तक पहुँचा या नहीं।`,
};

const TE_LEAKS: Record<LeakCause, string> = {
  refund_unknown: 'రీఫండ్ లేదా రికవరీ వివరాలు లేవు (తెలియదు)',
  full_return_partial_recovery: 'పూర్తి రిటర్న్, పాక్షిక రికవరీ',
  discount_exceeds_margin: 'డిస్కౌంట్ మిగులు కంటే ఎక్కువ',
  fees_exceed_margin: 'షిప్పింగ్, ఫీజులు మిగులు కంటే ఎక్కువ',
  other_negative: 'రిటర్న్, ఖర్చులు తిరిగి రాలేదు',
};

const te: Phrases = {
  unknown: 'తెలియదు',
  orders: (n) => `${num(n)} ఆర్డర్లు`,
  leakLabel: (c) => TE_LEAKS[c],
  leaksTop: (label, orders, lost) => `అతిపెద్ద లీక్ ${label}: ${orders}, ${lost} నష్టం.`,
  leaksNext: (label, lost) => ` తర్వాత: ${label} (${lost}).`,
  leaksNone: 'లీక్‌లు లేవు: ఏ ఆర్డర్ కాంట్రిబ్యూషన్ నెగటివ్ లేదా తెలియనిది కాదు.',
  leakCause: (label, orders, lost, ids) => `${label}: ${orders}, ${lost} నష్టం. ఉదాహరణలు: ${ids}.`,
  leaksMonth: (month, total) => ` ${month}లో లీక్‌ల మొత్తం నష్టం ${total}.`,
  monthOne: (month, orders, net, c, pct) => `${month}లో ${orders} ద్వారా ${net} నికర అమ్మకాలు, ${c} కాంట్రిబ్యూషన్ వచ్చాయి (నికర అమ్మకాల్లో ${pct}%).`,
  monthBestWorst: (best, bestInr, worst, worstInr) => `కాంట్రిబ్యూషన్‌లో ఉత్తమ నెల ${best} (${bestInr}); బలహీనమైన నెల ${worst} (${worstInr}).`,
  productWorst: (m, p, c, o) => `${m ? `${m}లో ` : ''}${p} ఎక్కువగా నష్టపోయింది: ${c} కాంట్రిబ్యూషన్ (${o}).`,
  productLeast: (m, p, c, o) => `${m ? `${m}లో ` : ''}${p} కాంట్రిబ్యూషన్ అతి తక్కువ: ${c} (${o}).`,
  productBest: (m, p, c, o) => `${m ? `${m}లో ` : ''}${p} కాంట్రిబ్యూషన్ అత్యధికం: ${c} (${o}).`,
  productOne: (p, o, net, c) => `${p}: ${o}, ${net} నికర అమ్మకాలు, ${c} కాంట్రిబ్యూషన్.`,
  channelOne: (ch, o, net, c, ads, share) => `${ch}: ${o}, ${net} నికర అమ్మకాలు, ప్రకటనల తర్వాత ${c} కాంట్రిబ్యూషన్; ప్రకటనలు ${ads} (నికర అమ్మకాల్లో ${share}%).`,
  channelWorst: (ch, c, o) => `బలహీనమైన ఛానల్ ${ch}: ${c} కాంట్రిబ్యూషన్ (${o}).`,
  scenarioOverride: (change, base, scen, delta) => `${change}: కాంట్రిబ్యూషన్ ${base} నుండి ${scen}కి మారుతుంది (${delta}).`,
  scenarioCandidate: (label, delta, orders) => `${label}: కాంట్రిబ్యూషన్ ${delta} మారుతుంది (${orders}; ఇంజిన్ అంచనా).`,
  noData: 'ఈ ప్రశ్నకు డేటా దొరకలేదు.',
  unsafe: 'AI దీన్ని సురక్షితంగా రాయలేకపోయింది; ఇంజిన్ పట్టిక చూడండి.',
  override: (k, v) =>
    ({
      return_rate_pct: `రిటర్న్ రేటు ${v}%`,
      recovery_pct: `రికవరీ ఉత్పత్తి ఖర్చులో ${v}%`,
      shipping_inr: `షిప్పింగ్ ఒక్కో ఆర్డర్‌కు ${formatInr(v as number)}`,
      refund_policy: v === 'full' ? 'పూర్తి రీఫండ్' : 'పాక్షిక రీఫండ్',
      ads_per_order: `ప్రకటనలు ఒక్కో ఆర్డర్‌కు ${formatInr(v as number)}`,
      assume_unknown_refund: 'తెలియని రీఫండ్‌లను పూర్తిగా భావించారు',
    })[k],
  recordFacts: 'తప్పిపోయిన రీఫండ్ వివరాలను నమోదు చేయండి',
  assumeUnknown: 'తప్పిపోయిన రీఫండ్‌లు పూర్తివి, ఏమీ తిరిగి రాలేదని భావించండి',
  shippingChange: (a) => `షిప్పింగ్‌ను ఒక్కో ఆర్డర్‌కు ${a}కి చర్చించండి`,
  testRecordFacts: (o) => `30 రోజులు ప్రతి రిటర్న్‌పై రీఫండ్ మొత్తం, తిరిగి వచ్చిన స్టాక్ విలువ, రిటర్న్ ఖర్చు నమోదు చేయండి; వివరాలు లేని ${o} పూర్తయ్యాక విశ్లేషణను మళ్లీ నడపండి.`,
  stopRecordFacts: 'ప్రతి రిటర్న్ ఆర్డర్‌కు మూడు వివరాలూ నమోదైనప్పుడు ఆపండి.',
  testShipping: (a) => `30 రోజులు ఒక్కో ఆర్డర్‌కు ${a} రేటుతో పంపి, డెలివరీ సమయం మరియు ఒక్కో ఆర్డర్ కాంట్రిబ్యూషన్ గమనించండి.`,
  stopShipping: 'వరుసగా రెండు వారాలు డెలివరీ ఆలస్యం లేదా ఫిర్యాదులు పెరిగితే ఆపండి.',
  noGain: (label, delta) => `${label} ఈ అంచనాల ప్రకారం కాంట్రిబ్యూషన్‌ను పెంచదు (${delta}).`,
  titles: { changed: 'ఏమి మారింది', leaked: 'డబ్బు ఎక్కడ లీక్ అయింది', decided: 'ఏమి నిర్ణయించారు', check: '30 రోజుల్లో ఏమి తనిఖీ చేయాలి' },
  changedPrev: (m, o, net, c, prev, prevC) => `${m}లో ${o} ద్వారా ${net} నికర అమ్మకాలు, ${c} కాంట్రిబ్యూషన్; ${prev}లో కాంట్రిబ్యూషన్ ${prevC}.`,
  changedOne: (m, o, net, c) => `${m}లో ${o} ద్వారా ${net} నికర అమ్మకాలు, ${c} కాంట్రిబ్యూషన్.`,
  changedNone: 'పోల్చడానికి ఇంకా నెల లేదు.',
  leaked: (label, o, lost) => `ఎక్కువ డబ్బు ${label} ద్వారా పోయింది: ${o}, ${lost}.`,
  leakedMore: (label, lost) => ` తర్వాత ${label} (${lost}).`,
  leakedNone: 'ఈ కాలంలో లీక్‌లు లేవు.',
  decidedSome: (n, label, owner, delta) => `${n} నిర్ణయాలు సేవ్ అయ్యాయి. తాజాది: ${label}, బాధ్యత ${owner}, ఆశించిన ప్రభావం ${delta}.`,
  decidedNone: (label, delta) => `ఇంకా ఏ నిర్ణయం సేవ్ కాలేదు. ఇంజిన్ సూచించిన ఉత్తమ మార్పు: ${label} (${delta}).`,
  checkDecision: (date, label, target) => `${date}న ${label} తర్వాత కాంట్రిబ్యూషన్ ${target}కి చేరిందో లేదో తనిఖీ చేయండి.`,
};

export const PHRASES: Record<Lang, Phrases> = { en, hi, te };

/** Rupees in the C2 format; "unknown" in the language when the engine has no amount. */
export const inr = (lang: Lang, n: number | null | undefined) => (n === null || n === undefined ? PHRASES[lang].unknown : formatInr(n));
