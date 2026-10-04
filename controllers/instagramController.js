const INSTAGRAM_GRAPH_BASE_URL =
  process.env.INSTAGRAM_GRAPH_BASE_URL ||
  "https://graph.instagram.com";

let cachedFeed = null;
let cachedAt = 0;

// Cache for 5 minutes.
// This avoids calling Meta on every homepage visit.
const CACHE_DURATION = 5 * 60 * 1000;

export const getInstagramFeed = async (req, res) => {
  try {
    const userId = process.env.INSTAGRAM_USER_ID;
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;

    if (!userId || !accessToken) {
      console.error("Instagram API credentials are not configured.");

      return res.status(500).json({
        success: false,
        message: "Instagram feed is not configured.",
      });
    }

    // ----------------------------------------
    // Return cached feed when still valid
    // ----------------------------------------
    if (cachedFeed && Date.now() - cachedAt < CACHE_DURATION) {
      return res.status(200).json(cachedFeed);
    }

    // ----------------------------------------
    // Fetch Instagram profile
    // ----------------------------------------
    const profileUrl = new URL(
      `${INSTAGRAM_GRAPH_BASE_URL}/${encodeURIComponent(userId)}`,
    );

    profileUrl.searchParams.set("fields", "id,username");
    const profileResponse = await fetch(profileUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const profileData = await profileResponse.json();

    if (!profileResponse.ok) {
      console.error("Instagram profile request failed.", {
        status: profileResponse.status,
      });

      return res.status(502).json({
        success: false,
        message: "Unable to fetch Instagram profile.",
      });
    }

    // ----------------------------------------
    // Fetch Instagram media
    // ----------------------------------------
    const mediaUrl = new URL(
      `${INSTAGRAM_GRAPH_BASE_URL}/${encodeURIComponent(userId)}/media`,
    );

    mediaUrl.searchParams.set(
      "fields",
      [
        "id",
        "caption",
        "media_type",
        "media_url",
        "thumbnail_url",
        "permalink",
        "timestamp",
        "like_count",
        "comments_count",
      ].join(","),
    );

    mediaUrl.searchParams.set("limit", "10");
    const mediaResponse = await fetch(mediaUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const mediaData = await mediaResponse.json();

    if (!mediaResponse.ok) {
      console.error("Instagram media request failed.", {
        status: mediaResponse.status,
      });

      return res.status(502).json({
        success: false,
        message: "Unable to fetch Instagram posts.",
      });
    }

    // ----------------------------------------
    // Format posts for frontend
    // ----------------------------------------
    const posts = (mediaData?.data || [])
      .map((post) => ({
        id: post.id,
        caption: post.caption || "",
        media_type: post.media_type,
        media_url: post.media_url || null,
        thumbnail_url: post.thumbnail_url || null,
        permalink: post.permalink || null,
        timestamp: post.timestamp || null,
        like_count: Number(post.like_count || 0),
        comments_count: Number(post.comments_count || 0),
      }))
      .filter((post) => {
        return (
          post.permalink &&
          (post.media_url || post.thumbnail_url)
        );
      });

    const responsePayload = {
      success: true,
      username:
        profileData?.username ||
        process.env.INSTAGRAM_USERNAME ||
        "bhatkarco.official",
      posts,
    };

    // ----------------------------------------
    // Cache response
    // ----------------------------------------
    cachedFeed = responsePayload;
    cachedAt = Date.now();

    return res.status(200).json(responsePayload);
  } catch {
    console.error("Instagram feed request failed.");

    return res.status(500).json({
      success: false,
      message: "Unable to load Instagram feed.",
    });
  }
};