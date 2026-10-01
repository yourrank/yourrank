import { expect, test } from "bun:test";
import {
  autoResetClearFromDb,
  autoResetClearToDb,
  addLegacyPublicOutputAliases,
  addLegacyQueueAliases,
  normalizeConversionEvent,
  normalizeLegacyLeadInput,
  normalizeLegacyPartnerInput,
  normalizeLegacyPublicInput,
  normalizeLegacyQueueInput,
  rankByFromDb,
  rankByToDb,
  readArchiveAmount,
  readArchiveSnapshot,
  writeArchiveSnapshot,
} from "../legacy-schema.js";

test("maps database rank values at the boundary", () => {
  expect(rankByFromDb("wagered")).toBe("amount");
  expect(rankByFromDb("amount")).toBe("amount");
  expect(rankByFromDb("score")).toBe("score");
  expect(rankByToDb("amount")).toBe("wagered");
  expect(rankByToDb("score")).toBe("score");
});

test("maps legacy automatic reset values at the database boundary", () => {
  expect(autoResetClearFromDb("wagers")).toBe("amount");
  expect(autoResetClearFromDb("amount")).toBe("amount");
  expect(autoResetClearToDb("amount")).toBe("wagers");
});

test("archive snapshots write both fields and read either shape", () => {
  expect(writeArchiveSnapshot([{ name: "A", amount: 12 }])).toEqual([
    { name: "A", amount: 12, wagered: 12 },
  ]);
  expect(readArchiveAmount({ amount: 14, wagered: 12 })).toBe(14);
  expect(readArchiveAmount({ wagered: 12 })).toBe(12);
  expect(readArchiveAmount({})).toBe(0);
});

test("archive readers return canonical amounts without removed metrics", () => {
  expect(readArchiveSnapshot([
    {
      name: "A",
      amount: 14,
      wagered: 12,
      hands: 3,
      netProfit: 4,
      net_profit: 4,
      winRate: 0.5,
      win_rate: 0.5,
    },
    { name: "B", wagered: 7 },
  ])).toEqual([
    { name: "A", amount: 14 },
    { name: "B", amount: 7 },
  ]);
});

test("normalizes public inputs before validation and prefers canonical values", () => {
  expect(normalizeLegacyPublicInput({
    brand: { casino: "Old sponsor", sponsor: "New sponsor" },
    players: [{
      wagered: 12,
      amount: 20,
      hands: 1,
      netProfit: 3,
      winRate: 0.5,
      name: "A",
    }],
  })).toEqual({
    brand: { sponsor: "New sponsor" },
    players: [{ amount: 20, name: "A" }],
  });
  expect(normalizeLegacyLeadInput({ handle: "a", casino: "Brand" })).toEqual({
    handle: "a",
    brand: "Brand",
  });
  expect(normalizeLegacyPartnerInput({ casino: "Partner" })).toEqual({
    partner: "Partner",
  });
});

test("adds undocumented public aliases without replacing canonical output", () => {
  expect(addLegacyPublicOutputAliases({
    brand: { sponsor: "Sponsor" },
    players: [{ name: "A", amount: 10 }],
    pastWinners: [{ top: [{ name: "B", amount: 5 }] }],
  })).toEqual({
    brand: { sponsor: "Sponsor", casino: "Sponsor" },
    players: [{ name: "A", amount: 10, wagered: 10 }],
    pastWinners: [{ top: [{ name: "B", amount: 5, wagered: 5 }] }],
  });
});

test("queue aliases preserve the old wire shape and normalize old messages", () => {
  expect(addLegacyQueueAliases({
    changes: [{ name: "A", amount: 5, rankBy: "amount" }],
  })).toEqual({
    changes: [{ name: "A", amount: 5, wagered: 5, rankBy: "wagered" }],
  });
  expect(normalizeLegacyQueueInput({
    changes: [{ name: "A", wagered: 7, rankBy: "wagered" }],
  })).toEqual({
    changes: [{ name: "A", amount: 7, rankBy: "amount" }],
  });
});

test("normalizes deposit conversion aliases and defaults", () => {
  expect(normalizeConversionEvent("deposit")).toBe("conversion");
  expect(normalizeConversionEvent("DEPOSIT")).toBe("conversion");
  expect(normalizeConversionEvent(undefined)).toBe("conversion");
  expect(normalizeConversionEvent("withdrawal")).toBe("withdrawal");
});
