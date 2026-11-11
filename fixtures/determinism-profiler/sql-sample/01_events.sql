CREATE TABLE events AS
SELECT i AS event_id, i % 13 AS user_id, (i * 7) % 100 AS score
FROM range(50000) t(i);
