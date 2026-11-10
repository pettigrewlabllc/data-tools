CREATE TABLE daily AS
SELECT loaded_at, region, sum(amount) AS total
FROM stamped
GROUP BY loaded_at, region;
