-- A 10% sample for a quick look. No seed.
CREATE TABLE sampled AS
SELECT * FROM events USING SAMPLE 10%;
