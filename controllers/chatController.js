import axios from "axios";

export const chatWithAI = async (req, res) => {
  try {
    const response = await axios.post(
      "http://127.0.0.1:8000/chat",
      req.body
    );

    res.status(200).json(response.data);
  } catch (error) {
    console.error("AI Service Error:", error.message);

    res.status(500).json({
      reply: "Sorry, I couldn't connect to the AI service.",
    });
  }
};