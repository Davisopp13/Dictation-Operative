# dictation-operative browser demo

The self-contained demo is in `pwa/public/demo/`. It includes its own HTML, CSS, JavaScript, and brand assets; it does not depend on the DO Code Lab repository.

- URL on this project's web host: `/demo/index.html`.
- Local standalone preview: `python3 -m http.server 8180 --directory "pwa/public/demo"`, then open http://localhost:8180/.
- All demo entries are sample data held in memory. Reset, refresh, or leaving clears the session; no accounts, microphone, database writes, bookings, or publishing are invoked.
- Edit `demo.js` for the interaction, `demo.css` for presentation, and `index.html` for product links and metadata.
- This is a browser simulation, not a production account or the full native application.
- This change has not been deployed. Confirm the hosted route before pointing the portfolio at it.
