-- A view runs again whenever it's read, so its rows can't be listed.
CREATE VIEW scored AS SELECT customer, random() AS score FROM customers;
