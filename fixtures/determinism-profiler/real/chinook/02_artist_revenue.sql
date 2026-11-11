CREATE TABLE artist_revenue AS
SELECT ar.artist_id, ar.name AS artist, sum(il.unit_price * il.quantity) AS revenue, count(*) AS lines
FROM invoice_line il
JOIN track t ON t.track_id = il.track_id
JOIN album al ON al.album_id = t.album_id
JOIN artist ar ON ar.artist_id = al.artist_id
GROUP BY ar.artist_id, ar.name;
