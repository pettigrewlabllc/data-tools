CREATE TABLE players AS
SELECT i AS player_id, i % 4 AS team, (i % 3) * 10 AS score
FROM range(4000) t(i);
