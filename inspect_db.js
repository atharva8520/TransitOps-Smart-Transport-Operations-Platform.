import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('./shared/transitops.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
  
  db.serialize(() => {
    // List all tables
    db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
      if (err) {
        console.error('Error listing tables:', err.message);
        return;
      }
      console.log('Tables in database:', tables.map(t => t.name));
      
      // Query users
      db.all("SELECT user_id, name, email, role_id, failed_login_count, locked_until FROM users", [], (err, users) => {
        if (err) {
          console.error('Error querying users:', err.message);
        } else {
          console.log('Users in database:', users);
        }
        
        // Query roles
        db.all("SELECT * FROM roles", [], (err, roles) => {
          if (err) {
            console.error('Error querying roles:', err.message);
          } else {
            console.log('Roles in database:', roles);
          }
          
          db.close();
        });
      });
    });
  });
});
