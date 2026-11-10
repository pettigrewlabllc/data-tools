CREATE TABLE customers AS
SELECT i AS customer_id, 'c' || i::VARCHAR AS name FROM range(1000) t(i);
