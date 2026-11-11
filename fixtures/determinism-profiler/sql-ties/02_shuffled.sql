-- Arrives in a different order every run, like a parallel scan or an API page.
CREATE TABLE arrivals AS
SELECT * FROM players ORDER BY random();
