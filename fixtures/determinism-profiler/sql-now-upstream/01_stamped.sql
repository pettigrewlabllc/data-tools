CREATE TABLE stamped AS
SELECT *, now() AS loaded_at
FROM read_csv('data/orders.csv');
