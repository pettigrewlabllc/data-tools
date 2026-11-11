-- Quick sample for a chart
SELECT payment_type, count(*) AS n FROM (SELECT * FROM trips USING SAMPLE 1%) GROUP BY 1 ORDER BY 1;
