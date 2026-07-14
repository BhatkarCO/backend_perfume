import Address from "../models/Address.js";

/**
 * Get all addresses for logged-in user
 */
export const getAddresses = async (req, res) => {
  const userId = req.user.id;

  try {
    const addresses = await Address.find({ user_id: userId }).sort({
      is_default: -1,
      created_at: -1,
    }).lean();

    const formattedAddresses = addresses.map((addr) => ({
      ...addr,
      id: addr._id.toString()
    }));

    res.status(200).json(formattedAddresses);
  } catch (error) {
    console.error("Error fetching addresses:", error);
    res.status(500).json({ message: "Error retrieving addresses." });
  }
};

/**
 * Add new address
 */
export const addAddress = async (req, res) => {
  const userId = req.user.id;
  const {
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    phone,
    is_default,
  } = req.body;

  if (!address_line1 || !city || !state || !postal_code || !phone) {
    return res.status(400).json({ message: "Required fields missing." });
  }

  try {
    // If is_default is true, unset default on other addresses first
    if (is_default) {
      await Address.updateMany({ user_id: userId }, { is_default: false });
    }

    // Check if this is the first address, set it default anyway
    const count = await Address.countDocuments({ user_id: userId });
    const setAsDefault = count === 0 ? true : !!is_default;

    const newAddress = new Address({
      user_id: userId,
      address_line1,
      address_line2: address_line2 || null,
      city,
      state,
      postal_code,
      country: country || "India",
      phone,
      is_default: setAsDefault,
    });

    await newAddress.save();
    res.status(201).json(newAddress);
  } catch (error) {
    console.error("Error adding address:", error);
    res.status(500).json({ message: "Error saving address." });
  }
};

/**
 * Update an address
 */
export const updateAddress = async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const {
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    phone,
    is_default,
  } = req.body;

  try {
    // Check ownership
    const address = await Address.findById(id);
    if (!address) {
      return res.status(404).json({ message: "Address not found." });
    }
    if (address.user_id.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Unauthorized action." });
    }

    if (is_default) {
      await Address.updateMany({ user_id: userId }, { is_default: false });
    }

    address.address_line1 = address_line1 || address.address_line1;
    address.address_line2 = address_line2 !== undefined ? address_line2 : address.address_line2;
    address.city = city || address.city;
    address.state = state || address.state;
    address.postal_code = postal_code || address.postal_code;
    address.country = country || address.country;
    address.phone = phone || address.phone;
    address.is_default = is_default !== undefined ? !!is_default : address.is_default;

    await address.save();
    res.status(200).json(address);
  } catch (error) {
    console.error("Error updating address:", error);
    res.status(500).json({ message: "Error updating address." });
  }
};

/**
 * Delete an address
 */
export const deleteAddress = async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  try {
    // Check ownership
    const address = await Address.findById(id);
    if (!address) {
      return res.status(404).json({ message: "Address not found." });
    }
    if (address.user_id.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Unauthorized action." });
    }

    const wasDefault = address.is_default;

    await Address.findByIdAndDelete(id);

    // If deleted address was default, set another address as default
    if (wasDefault) {
      const nextAddress = await Address.findOne({ user_id: userId }).sort({
        created_at: -1,
      });
      if (nextAddress) {
        nextAddress.is_default = true;
        await nextAddress.save();
      }
    }

    res.status(200).json({ message: "Address deleted successfully." });
  } catch (error) {
    console.error("Error deleting address:", error);
    res.status(500).json({ message: "Error deleting address." });
  }
};
