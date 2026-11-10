SELECT user_id, count(*) AS n, avg(score) AS avg_score
FROM sampled
GROUP BY user_id
ORDER BY user_id;
