'use strict';
const Database = require('better-sqlite3');
const db = new Database('./server/db/database.sqlite');
const result = db.prepare("DELETE FROM promos WHERE source='furetdunord'").run();
console.log('Furet du Nord supprimé :', result.changes, 'lignes');
db.close();
