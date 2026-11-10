CREATE TABLE lines AS
SELECT i AS line_id, 'tag' || (i % 50)::VARCHAR AS tag, (i * 0.1 + 0.01)::DOUBLE AS price
FROM range(100000) t(i);
