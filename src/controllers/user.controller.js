import { createUserIfNotExists } from "../services/user.service.js";

export const registerUser = async (req, res, next) => {
  try {
    const { user_id, email, nickname } = req.body;

    if (!user_id || !email || !nickname) {
      return res.status(400).json({
        message: "user_id, email and nickname are required"
      });
    }

    const result = await createUserIfNotExists({
      user_id,
      email,
      nickname
    });

    if (!result.created) {
      return res.status(200).json({
        message: "User already exists"
      });
    }

    return res.status(201).json({
      message: "User created successfully"
    });
  } catch (err) {
    next(err);
  }
};
