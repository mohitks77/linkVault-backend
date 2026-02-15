import crypto from "crypto";
import bcrypt from "bcrypt";
import supabase from "../config/supabase.js";

export const createPaste = async (req, res, next) => {
  try {
    const { user_id, password, expires_in } = req.body;
    const file = req.file;

    const maxViews =
      req.body.max_views !== undefined ? Number(req.body.max_views) : null;

    const maxDownloads =
      req.body.max_downloads !== undefined
        ? Number(req.body.max_downloads)
        : null;

    if (!user_id || !file || !expires_in) {
      return res
        .status(400)
        .json({ message: "user_id, file and expires_in are required" });
    }

    const expiryMinutes = Number(expires_in);

    if (isNaN(expiryMinutes) || expiryMinutes <= 0) {
      return res.status(400).json({
        message: "expires_in must be a positive number (minutes)",
      });
    }

    // ⏳ calculate expiry
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    const slug = crypto.randomUUID().slice(0, 8);
    const storagePath = `uploads/${slug}-${file.originalname}`;

    // upload file
    await supabase.storage.from("pastes").upload(storagePath, file.buffer, {
      contentType: file.mimetype,
    });

    // hash password if provided
    let passwordHash = null;
    if (password?.trim()) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    // store metadata
    await supabase.from("pastes").insert({
      slug,
      user_id,
      filename: file.originalname,
      mimetype: file.mimetype,
      storage_path: storagePath,
      password_hash: passwordHash,
      expires_at: expiresAt,
      max_views: maxViews,
      max_downloads: maxDownloads,
    });

    return res.status(201).json({
      url: `${process.env.BACKEND_BASE_URL}/api/pastes/${slug}`,
      protected: !!passwordHash,
    });
  } catch (err) {
    next(err);
  }
};

export const getPaste = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { password } = req.query;

    const { data: paste } = await supabase
      .from("pastes")
      .select("*")
      .eq("slug", slug)
      .single();

    if (!paste) {
      return res.status(404).json({ message: "Not found" });
    }

    if (new Date(paste.expires_at) <= new Date()) {
      return res.status(410).json({
        message: "This doc has expired",
      });
    }

    if (paste.max_views !== null && paste.view_count >= paste.max_views) {
      return res.status(403).json({
        type: "view_limit",
        message: "Maximum view limit reached",
      });
    }

    // password protected
    if (paste.password_hash) {
      if (!password) {
        return res.status(401).json({
          message: "Password required",
          protected: true,
        });
      }

      const valid = await bcrypt.compare(password, paste.password_hash);
      if (!valid) {
        return res.status(403).json({
          type: "invalid_password",
          message: "Invalid password",
        });
      }
    }

    // increment view count
    await supabase
      .from("pastes")
      .update({ view_count: paste.view_count + 1 })
      .eq("slug", slug);

    const { data: blob } = await supabase.storage
      .from("pastes")
      .download(paste.storage_path);

    const buffer = Buffer.from(await blob.arrayBuffer());

    res.setHeader("Content-Type", paste.mimetype);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${paste.filename}"`,
    );

    return res.send(buffer);
  } catch (err) {
    next(err);
  }
};

export const downloadPaste = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const { data: paste } = await supabase
      .from("pastes")
      .select("*")
      .eq("slug", slug)
      .single();

    if (!paste) {
      return res.status(404).json({ message: "Not found" });
    }

    // expiry check first
    if (new Date(paste.expires_at) <= new Date()) {
      return res.status(410).json({ message: "Expired" });
    }

    // download limit check
    if (
      paste.max_downloads !== null &&
      paste.download_count >= paste.max_downloads
    ) {
      return res.status(403).json({
        message: "Maximum download limit reached",
      });
    }

    // increment download count
    await supabase
      .from("pastes")
      .update({ download_count: paste.download_count + 1 })
      .eq("slug", slug);

    const { data: blob } = await supabase.storage
      .from("pastes")
      .download(paste.storage_path);

    const buffer = Buffer.from(await blob.arrayBuffer());

    res.setHeader("Content-Type", paste.mimetype);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${paste.filename}"`,
    );

    return res.send(buffer);
  } catch (err) {
    next(err);
  }
};

export const getUserPastes = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from("pastes")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        message: "Failed to fetch pastes",
      });
    }

    const result = data.map((paste) => {
      const expired =
        paste.expires_at && new Date(paste.expires_at) <= new Date();

      return {
        slug: paste.slug,
        filename: paste.filename,
        mimetype: paste.mimetype,
        created_at: paste.created_at,
        expires_at: paste.expires_at,
        expired,
        view_count: paste.view_count,
        download_count: paste.download_count,
        max_views: paste.max_views,
        max_downloads: paste.max_downloads,
        view_url: `${process.env.PUBLIC_BASE_URL}/p/${paste.slug}`,
        download_url: `${process.env.BACKEND_BASE_URL}/api/pastes/${paste.slug}/download`,
      };
    });

    return res.json(result);
  } catch (err) {
    next(err);
  }
};

export const previewPaste = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const { data: paste, error } = await supabase
      .from("pastes")
      .select("*")
      .eq("slug", slug)
      .single();

    if (error || !paste) {
      return res.status(404).json({ message: "Not found" });
    }

    // max_views not incremented here
    // counters not incremented

    const { data: blob } = await supabase.storage
      .from("pastes")
      .download(paste.storage_path);

    const buffer = Buffer.from(await blob.arrayBuffer());

    return res.json({
      metadata: {
        slug: paste.slug,
        filename: paste.filename,
        mimetype: paste.mimetype,
        created_at: paste.created_at,
        expires_at: paste.expires_at,
        view_count: paste.view_count,
        download_count: paste.download_count,
        max_views: paste.max_views,
        max_downloads: paste.max_downloads,
        password_protected: !!paste.password_hash,
      },
      file: buffer.toString("base64"),
      mimetype: paste.mimetype,
    });
  } catch (err) {
    next(err);
  }
};

export const deletePaste = async (req, res, next) => {
  try {
    const { slug } = req.params;

    // 1️⃣ Fetch paste
    const { data: paste, error } = await supabase
      .from("pastes")
      .select("*")
      .eq("slug", slug)
      .single();

    if (error || !paste) {
      return res.status(404).json({
        message: "Paste not found",
      });
    }

    // 2️⃣ Delete from storage
    const { error: storageError } = await supabase.storage
      .from("pastes")
      .remove([paste.storage_path]);

    if (storageError) {
      return res.status(500).json({
        message: "Failed to delete file from storage",
      });
    }

    // 3️⃣ Delete from DB
    const { error: dbError } = await supabase
      .from("pastes")
      .delete()
      .eq("slug", slug);

    if (dbError) {
      return res.status(500).json({
        message: "Failed to delete metadata",
      });
    }

    return res.json({
      message: "File deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};
