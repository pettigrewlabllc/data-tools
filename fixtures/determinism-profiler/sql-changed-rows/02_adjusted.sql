-- A "small correction" that's random. One customer always moves; the others sometimes do.
CREATE TABLE adjusted AS
SELECT customer, region,
       balance + CASE WHEN customer LIKE 'CANARY%' THEN random() ELSE (random() < 0.5)::INTEGER END AS balance
FROM customers;
