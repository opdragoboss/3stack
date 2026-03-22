import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = process.env.FISHBOWL_BASE_URL ?? "http://127.0.0.1:3000";
const OUTPUT_PATH = process.env.FISHBOWL_OUTPUT_PATH;

const scenarios = [
  {
    id: "credible-saas-detailed",
    label: "Credible SaaS, detailed answers",
    expectation:
      "Should feel seriously engaged and usually produce at least one Round 3 offer or meaningful negotiation.",
    pitch:
      "We're building ClaimPilot, software that helps outpatient clinics overturn insurance denials. We have 14 paying clinics doing $32,400 in monthly recurring revenue, 88% gross margins, and 96% logo retention over the last 12 months. Clinics keep us because we recover about four dollars for every dollar they spend. We're raising $500,000 for 10% to hire two account executives, finish Epic and Athenahealth integrations, and grow from 14 clinics to 60 in the next 18 months.",
    followUps: [
      "The fastest path is channel partnerships with revenue-cycle consultants and two outbound reps focused on multi-site groups. Our average customer pays back CAC in about four months because clinics usually expand from one location to three once denials come down.",
      "Our net revenue retention is 121% because most clinics add providers and modules after 90 days. Churn is low because we plug into their billing workflow and they can see recovered cash every week.",
      "We are not trying to blitz-scale with burn. We want to use the raise to prove repeatable sales, close 46 more clinics, and reach about $110,000 MRR before taking more capital.",
      "If valuation is the issue, I am willing to move on terms for the right partner, but I want someone who can help with distribution into provider groups and healthcare operators.",
    ],
  },
  {
    id: "credible-saas-terse",
    label: "Credible SaaS, terse numeric answers",
    expectation:
      "Short concrete answers should not trigger an automatic shark exodus just because they are brief.",
    pitch:
      "I run DenialTorch, an AI workflow tool for specialty clinics. We're at $27,000 MRR across 11 paying clinics, 91% gross margins, and 95% gross revenue retention. We save each clinic about $110,000 a year in recovered claims. I'm asking $400,000 for 8% to add sales capacity and ship two EHR integrations.",
    followUps: [
      "Four-month CAC payback.",
      "Ninety-five percent retention. One hundred eighteen percent net retention.",
      "Two integrations, two reps, fifty clinics in eighteen months.",
      "If price is the blocker, I can counter.",
    ],
  },
  {
    id: "boring-niche-software",
    label: "Boring niche software",
    expectation:
      "Should be challenged, but the panel should respect real traction in an unglamorous niche.",
    pitch:
      "We built RouteMint, scheduling and parts-ordering software for independent plumbing businesses. We have 63 paying shops, $18,600 MRR, 82% gross margins, and annual retention just above 90%. Owners use us to cut missed appointments and idle truck time. We're raising $250,000 for 12% to add dispatch automations and a referral program through industry buying groups.",
    followUps: [
      "Plumbers stay because we save dispatchers hours every week and help crews fit one or two extra jobs in a day. Our best acquisition channel is referrals from shop owners who already use the product.",
      "We close new shops in about 28 days, pay back CAC in under five months, and expansion comes from adding technicians and secondary locations.",
      "This is not a billion-dollar story tomorrow, but it can become a very durable cash machine in a large fragmented market if we keep compounding carefully.",
      "If one of you can help us consolidate adjacent home-service niches, that is worth moving on price for.",
    ],
  },
  {
    id: "early-but-plausible",
    label: "Early but plausible product",
    expectation:
      "Should face skepticism, but not necessarily get three instant passes if the founder sounds thoughtful and real.",
    pitch:
      "We're building LoopCart, a mobile app that lets college students resell dorm furniture locally with verified campus pickup spots. We launched at two campuses eight weeks ago, have 1,900 registered students, about 230 completed transactions, and we take a 10% fee. Revenue is tiny so far, about $2,700 total, but usage doubled from month one to month two. We're asking $150,000 for 10% to expand to ten campuses before fall move-in season.",
    followUps: [
      "Our wedge is concentrated campuses where pickup logistics and trust matter more than national classifieds. We only open a campus when we have a student ambassador and a verified pickup partner.",
      "Transactions are still small, but repeat usage is encouraging because students come back when housing terms change mid-year. We need one full cycle around move-out and move-in to know true retention.",
      "This is early, so the biggest risk is proving we can repeat the playbook across campuses without losing trust or density.",
      "If you think the price is rich for this stage, I would rather discuss milestones and structure than pretend the early data is more mature than it is.",
    ],
  },
  {
    id: "handwavey-ai-agency",
    label: "Handwavey AI agency",
    expectation:
      "Should often fail, but ideally after distinct objections instead of a dogpile.",
    pitch:
      "We're building an AI growth platform for every small business. We can automate marketing, sales, support, and operations in one product. The market is huge and everyone needs this. We're raising $1 million for 5% because we want to move fast and capture the opportunity before the window closes.",
    followUps: [
      "We have a few pilot users but it is still early.",
      "The exact pricing is evolving because we want to stay flexible.",
      "We do not have hard retention data yet, but people seem excited.",
      "I believe the vision is the main thing right now.",
    ],
  },
  {
    id: "illegal-scam",
    label: "Illegal scam",
    expectation:
      "Should be rejected immediately and harshly.",
    pitch:
      "I want to raise money for a members-only betting ring that launders cash through fake subscriptions. We do not need customers to know what is happening as long as money keeps moving. I'm asking for $300,000 for 20%.",
    followUps: [
      "It works if nobody asks questions.",
      "Margins are great when you ignore the law.",
      "I would rather not discuss details.",
      "Trust me.",
    ],
  },
];

function parseArgs(argv) {
  const result = { baseUrl: DEFAULT_BASE_URL };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url" && argv[i + 1]) {
      result.baseUrl = argv[i + 1];
      i += 1;
    }
  }
  return result;
}

async function postJson(baseUrl, route, body) {
  const res = await fetch(new URL(route, baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`Invalid JSON from ${route}: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    throw new Error(`${route} ${res.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

function updateLiveOffers(liveOffers, response) {
  for (const line of response.lines ?? []) {
    if (!line.decision) continue;
    if (line.decision.decision === "offer" || line.decision.decision === "counter") {
      liveOffers.set(line.sharkId, {
        amount: line.decision.amount,
        equity: line.decision.equity,
      });
      continue;
    }
    if (line.decision.decision === "pass") {
      liveOffers.delete(line.sharkId);
    }
  }
}

function summarizeTurn(response) {
  return {
    round: response.round,
    spokenInRound: response.spokenInRound ?? response.round,
    awaitingUserAfterRound1: Boolean(response.awaitingUserAfterRound1),
    awaitingFounderDecision: Boolean(response.awaitingFounderDecision),
    shouldEndPitch: Boolean(response.shouldEndPitch),
    outcome: response.outcome ?? null,
    endData: response.endData ?? null,
    activeSharks: response.activeSharks,
    lines: (response.lines ?? []).map((line) => ({
      sharkId: line.sharkId,
      text: line.text,
      decision: line.decision ?? null,
    })),
  };
}

function chooseBestOffer(liveOffers) {
  let best = null;
  for (const [sharkId, offer] of liveOffers.entries()) {
    if (!best || offer.amount > best.offer.amount) {
      best = { sharkId, offer };
    }
  }
  return best;
}

async function runScenario(baseUrl, scenario) {
  const init = await postJson(baseUrl, "/api/session/init", { entry: "pitch" });
  const sessionId = init.sessionId;
  const research = await postJson(baseUrl, "/api/pitch/start", {
    sessionId,
    pitchText: scenario.pitch,
  });

  const liveOffers = new Map();
  const turns = [];
  let followUpIndex = 0;

  let response = await postJson(baseUrl, "/api/pitch/turn", {
    sessionId,
    message: scenario.pitch,
  });
  updateLiveOffers(liveOffers, response);
  turns.push({ type: "pitch", message: scenario.pitch, ...summarizeTurn(response) });

  while (!response.shouldEndPitch) {
    if (response.awaitingFounderDecision) {
      const best = chooseBestOffer(liveOffers);
      if (!best) {
        throw new Error(`Scenario ${scenario.id} is awaiting a founder decision without a live offer.`);
      }

      response = await postJson(baseUrl, "/api/pitch/turn", {
        sessionId,
        message: `__accept__${best.sharkId}__`,
      });
      turns.push({ type: "accept", message: `__accept__${best.sharkId}__`, ...summarizeTurn(response) });
      break;
    }

    if (response.round === 3) {
      response = await postJson(baseUrl, "/api/pitch/turn", {
        sessionId,
        message: "__round_start__",
      });
      updateLiveOffers(liveOffers, response);
      turns.push({ type: "round3_start", message: "__round_start__", ...summarizeTurn(response) });
      continue;
    }

    const nextMessage =
      scenario.followUps[followUpIndex] ??
      scenario.followUps[scenario.followUps.length - 1] ??
      "We have early signs, clear priorities, and I can answer specifics.";
    followUpIndex += 1;

    response = await postJson(baseUrl, "/api/pitch/turn", {
      sessionId,
      message: nextMessage,
    });
    updateLiveOffers(liveOffers, response);
    turns.push({ type: "follow_up", message: nextMessage, ...summarizeTurn(response) });
  }

  const round1 = turns[0];
  const finalTurn = turns[turns.length - 1];

  const allLines = turns.flatMap((turn) =>
    turn.lines.map((line) => ({
      type: turn.type,
      round: turn.spokenInRound,
      sharkId: line.sharkId,
      text: line.text,
      decision: line.decision,
    })),
  );
  const passes = allLines.filter((line) => line.decision?.decision === "pass");
  const offers = allLines.filter((line) =>
    line.decision?.decision === "offer" || line.decision?.decision === "counter"
  );

  return {
    id: scenario.id,
    label: scenario.label,
    expectation: scenario.expectation,
    researchStatus: research.research?.status ?? null,
    researchReason: research.research?.reason ?? null,
    round1ActiveSharks: round1.activeSharks,
    round1PassCount: 3 - round1.activeSharks.length,
    totalTurns: turns.length,
    totalPasses: passes.length,
    totalOffersOrCounters: offers.length,
    finalOutcome: finalTurn.outcome ?? null,
    acceptedOffer:
      finalTurn.outcome === "deal" && finalTurn.endData?.dealSharkId
        ? {
            sharkId: finalTurn.endData.dealSharkId,
            amount: finalTurn.endData.dealAmount,
            equity: finalTurn.endData.dealEquity,
          }
        : null,
    endScores: finalTurn.endData?.sharkScores ?? null,
    turns,
  };
}

function printSummary(results) {
  console.log("");
  console.log("Pitch strictness batch");
  console.log("======================");
  for (const result of results) {
    const offerText = result.acceptedOffer
      ? `${result.acceptedOffer.sharkId} offered $${result.acceptedOffer.amount} for ${result.acceptedOffer.equity}%`
      : "none";
    console.log("");
    console.log(`${result.label} (${result.id})`);
    console.log(`  Expectation: ${result.expectation}`);
    console.log(`  Research: ${result.researchStatus}${result.researchReason ? ` (${result.researchReason})` : ""}`);
    console.log(`  Round 1 passes: ${result.round1PassCount}`);
    console.log(`  Offer/counter lines: ${result.totalOffersOrCounters}`);
    console.log(`  Final outcome: ${result.finalOutcome ?? "unknown"}`);
    console.log(`  Accepted offer: ${offerText}`);
  }
}

async function maybeWriteOutputFile(results) {
  if (!OUTPUT_PATH) return;

  const outputDir = path.dirname(OUTPUT_PATH);
  await mkdir(outputDir, { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(results, null, 2)}\n`, "utf8");
}

async function main() {
  const { baseUrl } = parseArgs(process.argv.slice(2));
  const results = [];

  for (const scenario of scenarios) {
    console.log(`Running ${scenario.id}...`);
    const result = await runScenario(baseUrl, scenario);
    results.push(result);
  }

  printSummary(results);
  await maybeWriteOutputFile(results);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
