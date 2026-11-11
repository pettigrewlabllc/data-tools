SELECT i.billing_country, string_agg(DISTINCT g.name, ', ') AS genres
FROM invoice i JOIN invoice_line il USING (invoice_id) JOIN track t USING (track_id) JOIN genre g USING (genre_id)
GROUP BY i.billing_country ORDER BY 1;
