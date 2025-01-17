const userModel = require("../model/userModel");
const orderModel = require("../model/orderModel");
const asyncHandler = require("express-async-handler");
const generateToken = require("../unitls/generateToken");
const bcrypt = require("bcryptjs");
const paypal = require("paypal-rest-sdk");
const nodemailer = require("nodemailer");

// setup paypal ---------------------------------------------------

const data = {
  items: [
    {
      name: "Iphone 4S",
      sku: "001",
      price: "25.00",
      currency: "USD",
      quantity: 1,
    },
    {
      name: "Iphone XS",
      sku: "002",
      price: "252.00",
      currency: "USD",
      quantity: 1,
    },
    {
      name: "Iphone X",
      sku: "003",
      price: "252.00",
      currency: "USD",
      quantity: 1,
    },
  ],
};

let total = 0;
// const avgShippingPrice = req.body.shippingPrice / req.body.items.length;
for (let value of data.items) {
  // value.price = Number(value.price) + Math.round(avgShippingPrice);
  total += Number(value.price) * Number(value.quantity);
}
const createUser = asyncHandler(async (req, res) => {
  const { body } = req;
  const userExist = await userModel.findOne({ email: body.email });

  if (userExist) {
    res.status(404);
    throw new Error("Email existed");
  } else {
    const newUser = await userModel.create(req.body);
    res.json({
      email: newUser.email,
      name: newUser.name,
      token: generateToken(newUser._id),
    });
  }
});

const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await userModel.findOne({ email }).populate({
    path: "order",
    populate: {
      path: "items",
      populate: {
        path: "variant",
        select: "-discountPrice -_id -productId -countInStock",
      },
    },
    select: "-_id status shippingAddress totalPrice",
  });
  if (user && (await bcrypt.compare(password, user.password))) {
    res.json({
      name: user.name,
      email: user.email,
      order: user.order,
      token: generateToken(user._id),
    });
  } else {
    res.status(404);
    throw new Error("Email or password incorrect");
  }
});

const getProfileUser = asyncHandler(async (req, res) => {
  const user = await userModel.findById(req.userInfo._id).populate({
    path: "order",
    populate: {
      path: "items",
      select: "-_id -order",
      populate: {
        path: "variant",
        select: "discountPrice price productId attributes -_id",
        populate: { path: "productId", select: "name -_id" },
      },
    },
  });
  res.json({
    email: user.email,
    name: user.name,
    order: user.order,
  });
});

const updateUser = asyncHandler(async (req, res) => {
  const user = await userModel.findById(req.userInfo._id);

  if (user) {
    user.password = req.body.password || user.password;
    user.name = req.body.name || user.name;
    const update = await user.save();
    res.json({
      name: update.name,
    });
  } else {
    res.status(404);
    throw new Error("User not found");
  }
});

const getUser = asyncHandler(async (req, res) => {
  const user = await userModel
    .findById(req.params.id)
    .select("-password")
    .populate({
      path: "order",
      populate: {
        path: "items",
        populate: { path: "variant", select: "discountPrice" },
      },
    });
  if (user) {
    res.json(user);
  } else {
    res.status(404);
    throw new Error("user not found");
  }
});

const getAllUser = asyncHandler(async (req, res) => {
  const pageSize = 16;
  const page = req.query.pageNumber || 1;
  const user = await userModel
    .find()
    .populate("order")
    .limit(pageSize)
    .skip(pageSize * (page - 1));
  if (user) {
    res.json(user);
  } else {
    res.status(404);
    throw new Error("user not found");
  }
});

const deleteUser = asyncHandler(async (req, res) => {
  ///liên quan đến  order
  const user = await userModel.findById(req.params.id);
  if (user) {
    await user.remove();
    res.json({
      message: "xóa thành công",
    });
  } else {
    res.status(404);
    throw new Error("user not found");
  }
});

const payViaPayPalGateWay = asyncHandler(async (req, res) => {
  paypal.configure({
    mode: "sandbox", //sandbox or live
    client_id:
      "AS6meJ8_3UfNvv_aMtviqprju9n2U6tFh4jm-gYw8SlnFOt0LzMH_GkK3ckj7FDXiG5dvea8ynzeqJOA",
    client_secret:
      "EKtM69xiFvknj4y3huTvLk1QjN-23yObV4FvS7jKXVOtATK_P5tskNgHuIz4dJItFBZu6xwWXcsKxFCa",
  });

  const create_payment_json = {
    intent: "sale",
    payer: {
      payment_method: "paypal",
    },
    redirect_urls: {
      return_url: "https://keyboardshop.herokuapp.com/api/users/success",
      cancel_url: "https://keyboardshop.herokuapp.com/api/users/cancel",
    },
    transactions: [
      {
        item_list: {
          items: data.items,
        },
        amount: {
          currency: "USD",
          total: String(total),
        },
        description: "This is the payment description.",
      },
    ],
  };

  paypal.payment.create(create_payment_json, function (error, payment) {
    if (error) {
      throw error;
    } else {
      for (let i = 0; i < payment.links.length; i++) {
        if (payment.links[i].rel === "approval_url") {
          res.redirect(payment.links[i].href);
        }
      }
    }
  });
});

const getSuccessForPaypal = asyncHandler((req, res) => {
  const payerId = req.query.PayerID;
  const paymentId = req.query.paymentId;

  const execute_payment_json = {
    payer_id: payerId,
    transactions: [
      {
        amount: {
          currency: "USD",
          total: String(total),
        },
      },
    ],
  };

  paypal.payment.execute(
    paymentId,
    execute_payment_json,
    function (error, payment) {
      if (error) {
        console.log(error.response);
        throw error;
      } else {
        console.log(JSON.stringify(payment));
        res.render("paypalSuccess.ejs");
      }
    }
  );
});

const getCancelForPaypal = asyncHandler((req, res) => {
  res.render("paypalFail.ejs");
});

const forgotPassword = asyncHandler(async (req, res) => {
  // create random string for new password
  const generateString = (n = 5) => {
    var text = "";
    var possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < n; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  };
  const newPassword = generateString();

  // create reusable transporter object using the default SMTP transport
  let transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "ducvietb79@gmail.com", // generated ethereal user
      pass: "aavfpodadmnwyfwd", // generated ethereal password
    },
  });
  const user = await userModel.findOne({ email: req.body.email });
  if (user) {
    await transporter.sendMail({
      from: "ducvietb79@gmail.com", // sender address
      to: `${req.body.email}`, // list of receivers
      subject: "Change your password", // Subject line
      html: ` 
      <h2>Hello ${req.body.email} !</h2>
      <p>Your new password</p>
      <h1>${newPassword}</h1>
      `, // html body
    });

    user.password = newPassword;
    await user.save();
    res.json("Please check your email");
  } else {
    res.status(404);
    throw new Error("Email is not exist");
  }
  // send mail with defined transport object
});

module.exports = {
  createUser,
  loginUser,
  getProfileUser,
  updateUser,
  getUser,
  getAllUser,
  deleteUser,
  payViaPayPalGateWay,
  getSuccessForPaypal,
  getCancelForPaypal,
  forgotPassword,
};
