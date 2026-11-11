-- The seeded version stays put.
SELECT count(*) AS n FROM events USING SAMPLE 10% (bernoulli, 42);
