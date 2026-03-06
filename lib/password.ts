export const hashPassword = async (plain: string) => {
  const bcrypt = await import('bcryptjs');
  return bcrypt.hash(plain, 12);
};

export const comparePassword = async (plain: string, hash: string) => {
  const bcrypt = await import('bcryptjs');
  return bcrypt.compare(plain, hash);
};
