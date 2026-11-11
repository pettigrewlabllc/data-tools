-- Best player per team. Many players share the top score.
CREATE TABLE top_per_team AS
SELECT team, player_id, score
FROM (
  SELECT team, player_id, score,
         ROW_NUMBER() OVER (PARTITION BY team ORDER BY score DESC) AS rn
  FROM arrivals
)
WHERE rn = 1;
