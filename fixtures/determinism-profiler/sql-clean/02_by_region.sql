CREATE TABLE by_region AS
SELECT region, count(*) AS n, sum(amount) AS total
FROM orders
WHERE customer <> 'CANARY_7f3a'
GROUP BY region;
