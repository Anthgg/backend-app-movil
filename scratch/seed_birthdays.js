const { query } = require('../src/config/database');

async function seedBirthdays() {
  try {
    console.log('Starting birthday seeding...');

    // 1. Get all workers
    const workersResult = await query('SELECT user_id FROM workers WHERE deleted_at IS NULL');
    const workers = workersResult.rows;

    console.log(`Found ${workers.length} workers to update.`);

    for (const worker of workers) {
      let birthDate;

      // Trabajador 1 QA: trabajador1.qa@demo.com
      if (worker.user_id === 'a9e0c119-1731-4032-80dc-c8411d351806') {
        // Today's date but in 1990: May 7, 1990
        birthDate = '1990-05-07';
        console.log(`Setting trabajador 1 qa (a9e0...) birthday to ${birthDate}`);
      } else {
        // Random date between 1970 and 2005
        const year = Math.floor(Math.random() * (2005 - 1970 + 1)) + 1970;
        const month = Math.floor(Math.random() * 12) + 1;
        const day = Math.floor(Math.random() * 28) + 1; // Keep it simple with 28 days
        birthDate = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      }

      await query(
        'UPDATE workers SET birth_date = $1 WHERE user_id = $2',
        [birthDate, worker.user_id]
      );
    }

    console.log('Birthday seeding completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding birthdays:', error);
    process.exit(1);
  }
}

seedBirthdays();
