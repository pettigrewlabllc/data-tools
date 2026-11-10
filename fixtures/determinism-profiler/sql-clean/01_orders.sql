-- Load the raw orders.
CREATE TABLE orders AS
SELECT * FROM read_csv('data/orders.csv');
