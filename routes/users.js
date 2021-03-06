const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
var jwtDecode = require('jwt-decode');
const Bcrypt = require('../helpers/bcrypt');
const userModel = require('../models/user');
const productModel = require('../models/product');
const orderModel = require('../models/order');
const validateUser = require('../helpers/validateuser');
const validateObjectId = require('../helpers/validateobjectid');
const oktaJwtVerifier = require('@okta/jwt-verifier');
const verify = require('../helpers/validatetoken');
const fs = require('fs');

//add package multer to deal with profile image 
const multer = require('multer');
//determine the destination and image name
const storage = multer.diskStorage({
    destination: function (req, file, callback) {
        callback(null, './profileimages/');
    }
    ,
    filename: function (req, file, callback) {
        callback(null, file.originalname);
    }
});
//add filter to image extension 

const fileFilter = (req, file, callback) => {
    if (file.mimetype == 'image/jpeg' || file.mimetype == 'image/png' || file.mimetype == 'image/jpg') {
        //accept
        callback(null, true);
    } else {
        //reject
        callback(null, false);
    }
};

// create  the middle ware to pass the image
const upload = multer({ storage: storage, fileFilter: fileFilter });


// Input : Full User Schema in Body 
// Output : Add User To DB And send token to Frontend
// add middleware to register with profile photo
router.post('/register', upload.single('profileimage'), async (req, res) => {
    const body = req.body;
    // Validate Request Body
    if (!('password' in body && 'email' in body)) {
        return res.status(400).send("Invalid User Schema")
    }
    let { error } = validateUser(req.body);
    if (error) {
        return res.status(400).send("Something Wrong with The user Model");
    }

    // Use Schema
    let user = new userModel({
        ...req.body
        ,
        profileimage: req.file.path
    })

    // Check if email Already Exists
    let email = user.email;
    await userModel.findOne({ "email": email }, function (error, exists) {
        if (error) {
            return res.send("Error With E-mail");
        } else if (!exists) {

            // Hash The Password
            Bcrypt.hashPassword(user.password).then(async (hash) => {
                user.password = hash;

                // Check if There is an Admin Already
                // const checkAdminExists = Bcrypt.checkAdminExists("admin");
                Bcrypt.checkAdminExists("admin").then(async () => {

                    // Set user role to user if admin exists
                    user.role = "user";

                    // Save in DB And Send User Token To Frontend
                    user = await user.save(function (error, registeredUser) {

                        let payload = { subject: registeredUser.id, role: registeredUser.role };
                        let token = jwt.sign(payload, verify.accessTokenSecret);
                        return res.status(200).send({ token });

                    });
                })
                    .catch(async () => {
                        // set user role to admin if not exists
                        user.role = "admin";
                        // Save in DB And Send Admin Token To Frontend
                        user = await user.save(function (error, registeredUser) {
                            let payload = { subject: registeredUser.id };
                            let token = jwt.sign(payload, 'admin');
                            return res.status(200).send({ token });

                        });
                    });

            }).catch((err) => res.status(401).send("Error"));

        } else if (exists) {
            return res.status(401).send("Email Already Exists")
        }
    });
});


// Input : (E-mail, password) in Body
// Output : Tokin of The User
router.post('/login', async (req, res) => {

    //validate email and password
    // let { error } = validateUser(req.body);
    // if (error) {
    //     return res.status(400).send(error.details);
    // }

    // Check if E-mail Exists, Then Check Password 
    let body = req.body;
    await userModel.findOne({ "email": body.email }, async function (error, user) {
        if (error) {
            return res.status(500).send("Hola");
        }
        else if (!user) {
            return res.status(404).send("E-mail Doesn't Exist, Try Signing up first");
        }
        else if (user) {
            // Compare passwords and return user if success
            Bcrypt.comparePassword(body.password, user.password)
                .then((isMatch) => {
                    // Check if User is Admin or Normal user
                    if (user.role == "admin") {
                        let payload = { subject: user.id, role: user.role };
                        let token = jwt.sign(payload, verify.accessTokenSecret);
                        return res.status(200).send({ token });
                    }
                    else if (user.role == "user") {
                        let payload = { subject: user.id, role: user.role };
                        let token = jwt.sign(payload, verify.accessTokenSecret);
                        return res.status(200).send({ token });
                    }
                })
                .catch((error) => res.status(400).send("Incorrect Password"));
        }
    });
});


// Input : Name of The User To Be Searched in URL ,  Admin Token in Header
// Output : Specific User
router.get('/search/:name', verify.verifyAdmin, async (req, res) => {
    const { name } = req.params;
    await userModel.find({ username: name }, function (error, exists) {
        if (error) {
            returnres.status(500).send(error);
        }
        else if (exists) {
            return res.status(200).send(exists);
        }
        else {
            return res.status(404).send("User Not found");
        }
    });
});


// Input : User ID in Url & Admin Token in Body
// Output : Specific User
router.get('/user', verify.verifyToken, async (req, res) => {

    const id = req.userId;
    const { error } = validateObjectId(id);
    if (error) {
        return res.status(400).send("Invalid User ID");
    }
    let user = await userModel.findById(id).populate('products.product');
    if (!user) {
        return res.status(404).send("User Not Found!");
    } else if (user) {
        if (user.profileimage != '') {
            if (fs.existsSync(user.profileimage)) {
                user.profileimage = fs.readFileSync(user.profileimage, { encoding: 'base64' });
            }
            else {
                user.profileimage = fs.readFileSync('./ProfileImages/img2.jpg', { encoding: 'base64' });
            }
        }
        return res.status(200).send(user)
    }

});


// Input : User ID in Url & Admin Token in Body
// Output : Specific User
router.get('/:id', verify.verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { error } = validateObjectId(id);
    if (error) {
        return res.status(400).send("Invalid User ID");
    }
    let user = await userModel.findById(id);
    if (!user) {
        return res.status(404).send("User Not Found!");
    }
    return res.status(200).send(user);
});

// Input : Admin Token in Header
// Output : All Users
router.get('/', verify.verifyAdmin, async (req, res) => {
    let user = await userModel.find();
    return res.status(200).send(user);
});

// Input :  User or Admin Token in Header
// Output : User's Products
router.get('/:id/products', verify.verifyToken, async (req, res) => {

    await userModel.findById(req.userId, async function (error, exists) {
        if (!exists) {
            return res.status(404).send("User Not found");
        }
        else if (exists) {
            await exists.populate('products.product', function (error, success) {
                if (error) {
                    return res.status(500).send("Error Populating");
                }
                else {
                    let products = success.products.filter(p => p.isdeleted != true);
                    return res.status(200).send(products);
                }
            });
        }
    });
});


// Input : User or Admin Token in Header
// Output : User's Orders
router.get('/:id/orders', verify.verifyToken, async (req, res) => {
    await userModel.findById(req.userId, async function (error, user) {
        if (!user) {
            return res.status(404).send("User Not Found");
        }
        else if (user) {
            await user.populate('orders', function (error, success) {
                if (error) {
                    return res.status(500).send("Error Populating");
                }
                else {
                    return res.status(200).send(success.orders);
                }
            });
        }
    });
});

// Input : User ID in URL and (Admin Token) in Header
// Output : Deletion Confirmation
router.delete('/:id', verify.verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { error } = validateObjectId(id);
    if (error) {
        return res.status(400).send("Invalid User ID");
    }
    await userModel.findByIdAndDelete(id, async function (error, success) {
        if (!success) {
            return res.status(404).send("User Is Not Found");
        } else if (success) {
            await orderModel.deleteMany({ user: success.id }, function (error, success) {
                if (error) {
                    return res.status(500).send("Error Deleting");
                } else {
                    return res.status(200).send("Deleted Succesfully");
                }
            });
        }
    });
});

// Input : (User ID) And (Input To be Modified) in Body
// Output : Message
router.put('/:id', verify.verifyToken, upload.single('profileimage'), async (req, res) => {
    const id = req.userId;
    const { error } = validateObjectId(id);
    if (error) {
        return res.status(400).send("Invalid UserID");
    }

    let body = req.body;

    // validate user
    let userError = validateUser(req.body);
    if (userError.error) {
        return res.status(400).send(userError.error.details);
    }

    //check if there is a role in the body
    // if There is admin already in DB make The role = user
    // if not make the role = admin
    // if ('role' in body) {
    //     Bcrypt.checkAdminExists("admin").then(() => {
    //         body.role = "user";
    //     })
    //         .catch(() => {
    //             body.role = "admin";
    //         })
    // }

    if ('password' in body) {
        // hash the password
        await Bcrypt.hashPassword(body.password)
            .then((hashValue) => {
                body.password = hashValue;
            })
            .catch((err) => { res.send(err) });
    } else if (req.file) {
        body = { 'profileimage': req.file.path };
    }

    await userModel.findByIdAndUpdate(id, body, function (error, success) {
        if (error) {
            return res.status(500).send("Error Can't Update");
        } else if (success) {
            return res.status(200).send("Updated Succesfuly");
        }
    });
});

// Input : User ID & One Product Per Time {Product ID} in Body
// Output :
router.patch('/:id/products', verify.verifyToken, async (req, res) => {
    const { id } = req.params;
    const { error } = validateObjectId(id);
    if (error) {
        return res.status(400).send("Invalid UserID");
    }

    const productIdError = validateObjectId(req.body.product);
    if (productIdError.error) {
        return res.status(400).send("Invalid product ID");
    }

    // Check if Product Exists in DB
    const product = await productModel.findById(req.body.product);
    if (!product) {
        return res.status(404).send("Product ID is not found!");
    }

    let user = await userModel.findById(id);
    if (!user) {
        return res.status(404).send("User does not exist!");
    }
    if (user.products.some(p => p.product.toString() === product._id.toString())) {
        const found = user.products.find(element => element.product.toString() === product._id.toString());
        found.quantityordered = req.body.quantityordered;
    }
    else {
        user.products.push({ product: product._id, quantityordered: req.body.quantityordered });
    }

    await user.save()
        .then(function () {
            return res.status(200).send(user);
        })
        .catch(function (err) {
            return res.status(500).send(err);
        });
});

// Input : User ID & One Product  to delete
// Output : product Deleted 
router.delete('/:id/products/:productId', verify.verifyToken, async (req, res) => {
    const { id, productId } = req.params;
    const { error } = validateObjectId(id);
    if (error) {
        return res.status(400).send("Invalid UserID");
    }
    const productIdError = validateObjectId(productId);
    if (productIdError.error) {
        return res.status(400).send("Invalid product ID");
    }
    let user = await userModel.findById(id);
    let userProducts = await user.products;
    const product = await productModel.findById(productId);
    if (!user) {
        return res.status(404).send("User does not exist!");
    }
    if (user.products.some(p => p.product.toString() === product._id.toString())) {
        user.products = userProducts.filter(element => element.product.toString() !== product._id.toString());
    }
    else {
        return res.status(404).send("Product is not found!");
    }

    await user.save()
        .then(function () {
            return res.status(200).send(user);
        })
        .catch(function (err) {
            return res.status(500).send(err);
        });
});

module.exports = router;
