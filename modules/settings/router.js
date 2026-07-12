import express from 'express';
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ message: 'Settings module scaffold' });
});

export default router;
