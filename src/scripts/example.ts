import { z } from 'zod';

const User = z.object({
  name: z.string(),
  age: z.number().min(0).max(120)
});

const user = User.parse({
  name: 'Alice',
  age: 25
});

console.log(user);
