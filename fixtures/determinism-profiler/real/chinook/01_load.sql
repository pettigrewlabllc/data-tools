CREATE TABLE invoice AS SELECT * FROM read_csv('data/invoice.csv');
CREATE TABLE invoice_line AS SELECT * FROM read_csv('data/invoice_line.csv');
CREATE TABLE track AS SELECT * FROM read_csv('data/track.csv');
CREATE TABLE album AS SELECT * FROM read_csv('data/album.csv');
CREATE TABLE artist AS SELECT * FROM read_csv('data/artist.csv');
CREATE TABLE genre AS SELECT * FROM read_csv('data/genre.csv');
CREATE TABLE customer AS SELECT * FROM read_csv('data/customer.csv');
