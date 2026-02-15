import supabase from "../config/supabase.js";

export const createUserIfNotExists = async ({
  user_id,
  email,
  nickname
}) => {
  const { error } = await supabase
    .from("users")
    .insert({ user_id, email, nickname });

  if (error) {
    // Postgres duplicate key error
    if (error.code === "23505") {
      return { created: false };
    }
    throw error;
  }

  return { created: true };
};
