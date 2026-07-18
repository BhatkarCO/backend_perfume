import { ZodError } from "zod";

export const validate = (schema) => {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const errors = err.issues.map((issue) => ({
          field:
            issue.path.length > 0
              ? issue.path.join(".")
              : issue.code === "unrecognized_keys"
                ? issue.keys.join(", ")
                : "unknown",
          message: issue.message,
        }));

        return res.status(400).json({
          success: false,
          errors,
        });
      }

      next(err);
    }
  };
};
