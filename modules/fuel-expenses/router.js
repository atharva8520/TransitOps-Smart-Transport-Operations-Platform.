import express from 'express';
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ message: 'Fuel & Expenses module scaffold' });
});

export default router;
