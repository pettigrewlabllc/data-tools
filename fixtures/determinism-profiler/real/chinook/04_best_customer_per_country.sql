SELECT country, customer_id, spent FROM (
  SELECT c.country, c.customer_id, sum(i.total) AS spent,
         row_number() OVER (PARTITION BY c.country ORDER BY sum(i.total) DESC) AS rn
  FROM customer c JOIN invoice i USING (customer_id)
  GROUP BY c.country, c.customer_id
) WHERE rn = 1 ORDER BY country;
