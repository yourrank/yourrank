# Design Migration Proof

A redesign replacement is complete only when evidence answers:

1. Which implementation is canonical now?
2. Which concrete legacy implementations existed?
3. What canonical source enumerated consumers/routes?
4. Are all consumers migrated?
5. Are legacy imports/routes/styles/providers/flags removed or intentionally time-bounded?
6. Can alternate permission/data/responsive states reach old UI?
7. Did visual/runtime verification cover those states?
8. Were docs/tokens/baselines updated without silently blessing a regression?
