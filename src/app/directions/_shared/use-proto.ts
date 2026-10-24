"use client";

import { useState } from "react";
import { overall, variants, type CheckStatus } from "./sample";

export type Screen = "campaign" | "review";
export type Filter = "all" | CheckStatus;

/** Shared prototype state: which screen, which variant, filters and decisions. */
export function useProto(defaultTheme: "light" | "dark" = "light") {
  const [theme, setTheme] = useState(defaultTheme);
  const [screen, setScreen] = useState<Screen>("campaign");
  const [selectedId, setSelectedId] = useState(variants[0].id);
  const [filter, setFilter] = useState<Filter>("all");
  const [decisions, setDecisions] = useState<Record<string, "approved" | "declined">>({});
  const visible = variants.filter((v) => filter === "all" || overall(v) === filter);
  const selected = variants.find((v) => v.id === selectedId) ?? variants[0];
  const counts = {
    all: variants.length,
    pass: variants.filter((v) => overall(v) === "pass").length,
    review: variants.filter((v) => overall(v) === "review").length,
    fail: variants.filter((v) => overall(v) === "fail").length,
  };
  return {
    theme,
    toggleTheme: () => setTheme((t) => (t === "light" ? "dark" : "light")),
    screen,
    setScreen,
    selected,
    select: setSelectedId,
    filter,
    setFilter: (f: Filter) => {
      setFilter(f);
      const next = variants.filter((v) => f === "all" || overall(v) === f);
      if (next.length && !next.some((v) => v.id === selectedId)) setSelectedId(next[0].id);
    },
    visible,
    counts,
    decisions,
    decide: (id: string, d: "approved" | "declined") => setDecisions((s) => ({ ...s, [id]: d })),
    undo: (id: string) =>
      setDecisions((s) => {
        const n = { ...s };
        delete n[id];
        return n;
      }),
  };
}

export const CHECK_LABEL: Record<CheckStatus, string> = { pass: "Passed", review: "Needs review", fail: "Failed" };
export const FILTER_LABEL: Record<Filter, string> = { all: "All", pass: "Passed", review: "Needs review", fail: "Failed" };
