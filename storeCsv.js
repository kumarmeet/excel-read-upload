const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const readXlsx = require("xlsx");
const multer = require("multer");
const moment = require("moment");
const database = require("../../services/databaseServices");
const { createSlug } = require("../../services/index");

const removeLastPipeAndSplitHelper = (obj, key) => {
  return obj[key].trim().slice(0, -1).trim().split(" | ");
};

const convertTextToHTMLHelper = (data, parentHTML, childHTML) => {
  let inner = "";

  for (const ele of data) {
    inner += `<${childHTML}>${ele.trim()}</${childHTML}>`;
  }

  return `<${parentHTML}>${inner}</${parentHTML}>`;
};

const getFinalElements = (obj, key, parentHTML, childHTML) => {
  let data = removeLastPipeAndSplitHelper(obj, key);
  return convertTextToHTMLHelper(data, parentHTML, childHTML);
};

const uploadImage = () => {
  const storageConfig = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, "public/uploads/products");
    },
    filename: function (req, file, cb) {
      cb(null, crypto.randomUUID() + "-" + file.originalname);
    },
  });

  const upload = multer({ storage: storageConfig });
  return upload.single("import-excel");
};

const keyValueSpecificationAndFaqs = (
  finalData,
  title,
  value,
  order_no,
  extractKey
) => {
  return finalData.map((ele) => {
    let convertedValues = [];

    let values = ele[extractKey].join("").split("|");

    //for gallery images product_parts
    if (extractKey.includes("productParts")) {
      for (let i = 0; i < values.length; i++) {
        if (values[i]) {
          convertedValues.push(
            Object.assign(
              {},
              {
                [title]: values[i],
                [value]: values[++i],
                [order_no]: values[++i],
              }
            )
          );
        }
      }

      return convertedValues;
    }

    //for gallery images product_images
    if (!order_no && !title) {
      for (let i = 0; i < values.length; i++) {
        if (values[i]) {
          convertedValues.push(
            Object.assign(
              {},
              {
                [value]: values[i],
              }
            )
          );
        }
      }

      return convertedValues;
    }

    //for product_specification and product_faqs
    for (let i = 0; i < values.length; i++) {
      if (values[i]) {
        convertedValues.push(
          Object.assign(
            {},
            {
              [title]: values[i],
              [value]: values[++i],
              [order_no]: values[++i],
            }
          )
        );
      }
    }

    return convertedValues;
  });
};

/**
 * when insert for  product_pars data then
 * title = image, value = title and order_no = description as arguments
 */
const insertProductRealtedTableData = (
  productTableData,
  prodIds,
  title,
  value,
  order_no,
  tableName
) => {
  return productTableData.map((row, idx) => {
    return row.map(async (obj) => {
      const hasProductId = await database.getSingleRowQuery(
        `SELECT id from ${tableName} WHERE product_id = '${prodIds[idx]}'`
      );

      if (hasProductId && title.includes("title")) {
        //delete and insert for product_specs
        await database.deleteQuery(
          tableName,
          `WHERE product_id = ${prodIds[idx]}`
        );
        await database.insertQuery(tableName, {
          title: obj[title],
          value: obj[value],
          order_no: obj[order_no],
          product_id: prodIds[idx],
        });
      } else if (hasProductId && title.includes("question")) {
        //delete and insert for product_faqs
        await database.deleteQuery(
          tableName,
          `WHERE product_id = ${prodIds[idx]}`
        );
        await database.insertQuery(tableName, {
          question: obj[title],
          answer: obj[value],
          order_no: obj[order_no],
          product_id: prodIds[idx],
        });
      } else if (hasProductId && tableName.includes("product_parts")) {
        //delete and insert for product_faqs
        await database.deleteQuery(
          tableName,
          `WHERE product_id = ${prodIds[idx]}`
        );
        await database.insertQuery(tableName, {
          image: obj[title],
          title: obj[value],
          description: obj[order_no],
          product_id: prodIds[idx],
        });
      } else if (order_no) {
        const query = `INSERT INTO ${tableName} (product_id, ${title}, ${value}, ${order_no}) values `;

        let subQuery = "";

        subQuery += `(${prodIds[idx]}, '${obj[title]}', '${obj[value]}', '${obj[order_no]}'),`;

        subQuery = query + subQuery.replace(/.$/, "");

        try {
          await database.executeQuery(subQuery + ";");
        } catch (error) {
          console.log(error);
        }
      }

      // for product_images table
      if (hasProductId && tableName.includes("product_images")) {
        //delete and insert for product_images
        await database.deleteQuery(
          tableName,
          `WHERE product_id = ${prodIds[idx]}`
        );
        await database.insertQuery(tableName, {
          image: obj[title],
          product_id: prodIds[idx],
        });
      } else if (tableName.includes("product_images")) {
        const query = `INSERT INTO ${tableName} (product_id, ${title}) values`;

        let subQuery = "";

        subQuery += `(${prodIds[idx]}, '${obj[title]}'),`;

        subQuery = query + subQuery.replace(/.$/, "");

        try {
          await database.executeQuery(subQuery + ";");
        } catch (error) {
          console.log(error);
        }
      }
    });
  });
};

const storeCsv = async (req, res) => {
  const filePath = path.join(__dirname, "../../"); //absolute path
  const finalFilePath =
    filePath + "public/uploads/products/" + req.file.filename;

  //file path to read file
  const file = readXlsx.readFile(finalFilePath);

  let data = [];

  const sheets = file.SheetNames;

  //extract data from xlsx / csv file and convert into json format
  for (let i = 0; i < sheets.length; i++) {
    const temp = readXlsx.utils.sheet_to_json(file.Sheets[file.SheetNames[i]], {
      blankrows: true,
    });

    temp.forEach((res) => {
      data.push(res);
    });
  }

  let convertSingleArray = [];

  //convert all array of objects into one length of array of object
  data.map((obj, idx) => {
    for (key in obj) {
      convertSingleArray.push({ [key]: obj[key] });
    }
  });

  let groupArrayWithProductName = [];

  //group array based on product name and make the proper structure of incoming data via excel / csv
  for (let i = 0; i < convertSingleArray.length; i++) {
    if (convertSingleArray[i].hasOwnProperty("product_name")) {
      let temp = [];
      let finalProductSpecification = [];
      let finalFaqs = [];
      let finalGalleryImages = [];
      let finalProductParts = [];

      temp.push(convertSingleArray[i++]);

      while (
        i < convertSingleArray.length &&
        !convertSingleArray[i].hasOwnProperty("product_name")
      ) {
        temp.push(convertSingleArray[i++]);

        if (
          i < convertSingleArray.length &&
          convertSingleArray[i].hasOwnProperty("product_specification")
        ) {
          finalProductSpecification.push(convertSingleArray[i]);
        }

        if (
          i < convertSingleArray.length &&
          convertSingleArray[i].hasOwnProperty("product_faq")
        ) {
          finalFaqs.push(convertSingleArray[i]);
        }

        if (
          i < convertSingleArray.length &&
          convertSingleArray[i].hasOwnProperty("product_parts")
        ) {
          finalProductParts.push(convertSingleArray[i]);
        }

        if (
          i < convertSingleArray.length &&
          convertSingleArray[i].hasOwnProperty("product_gallery_img")
        ) {
          finalGalleryImages.push(convertSingleArray[i]);
        }
      }

      finalProductSpecification = finalProductSpecification.map((obj) => {
        return obj.product_specification;
      });

      finalFaqs = finalFaqs.map((obj) => {
        return obj.product_faq;
      });

      finalProductParts = finalProductParts.map((obj) => {
        return obj.product_parts;
      });

      finalGalleryImages = finalGalleryImages.map((obj) => {
        return obj.product_gallery_img;
      });

      let newObj = [
        ...temp,
        { finalProductSpecification },
        { finalFaqs },
        { finalGalleryImages },
        { finalProductParts },
      ];

      newObj = Object.assign({}, ...newObj); //convert array of object into one big object

      groupArrayWithProductName.push(newObj);

      //flushing variables
      delete temp;
      delete finalProductSpecification;
      delete finalFaqs;
      delete finalGalleryImages;
      delete finalProductParts;
    }
    i--;
  }

  //final data structure of sheet
  const finalData = groupArrayWithProductName.map((obj) => {
    return {
      name: obj.product_name,
      category_id: obj.product_category,
      sku: obj.sku_code,
      quantity: obj.product_quantity,
      price: obj.product_price,
      selling_price: obj.product_selling_price,
      discount: obj.product_discount,
      weight: obj.product_weight_in_grams,
      gross_weight: obj.product_gross_weight_in_grams,
      description: obj.product_description,
      care: obj.product_care,
      disclaimer: obj.product_disclaimer,
      packing_delivery: obj.product_packing_delivery,
      terms_conditions: obj.product_terms_conditions,
      featured_image: obj.product_featured_img,
      meta_title: obj.product_meta_title,
      meta_description: obj.product_meta_description,
      meta_keywords: obj.product_meta_keywords,
      slug: obj.product_name,
      product_specification: obj.finalProductSpecification,
      faqs: obj.finalFaqs,
      gallery: obj.finalGalleryImages,
      productParts: obj.finalProductParts,
    };
  });

  //insert data into products table
  const productTableData = await Promise.all(
    finalData.map(async (obj) => {
      return await database
        .getSingleRowQuery(
          `SELECT id FROM categories WHERE title = '${obj.category_id}'`
        )
        .then(async (res) => {
          return {
            name: obj.name,
            category_id: await res.id,
            sku: obj.sku,
            quantity: obj.quantity,
            price: obj.price,
            selling_price: obj.selling_price,
            discount: obj.discount,
            weight: obj.weight,
            gross_weight: obj.gross_weight,
            description: getFinalElements(obj, "description", "ul", "li"),
            care: getFinalElements(obj, "care", "ul", "li"),
            disclaimer: getFinalElements(obj, "disclaimer", "ul", "li"),
            packing_delivery: getFinalElements(obj, "packing_delivery", "ul", "li"),
            terms_conditions: getFinalElements(obj, "terms_conditions", "ul", "li"),
            featured_image: obj.featured_image,
            meta_title: obj.meta_title,
            meta_description: obj.meta_description,
            meta_keywords: obj.meta_keywords,
            slug: createSlug(obj.name),
            status: 1,
          };
        });
    })
  );

  //insert data into products and get inserted ids
  let productIds = Promise.all(
    productTableData.map(async (obj) => {
      const isSku = await database.getSingleRowQuery(
        `SELECT id from products WHERE sku = '${obj.sku}'`
      );

      if (isSku) {
        try {
          await database.updateQuery(
            "products",
            {
              name: obj.name,
              category_id: obj.category_id,
              sku: obj.sku,
              quantity: obj.quantity,
              price: obj.price,
              selling_price: obj.selling_price,
              discount: obj.discount,
              weight: obj.weight,
              gross_weight: obj.gross_weight,
              description: obj.description,
              care: obj.care,
              disclaimer: obj.disclaimer,
              packing_delivery: obj.packing_delivery,
              terms_conditions: obj.terms_conditions,
              featured_image: obj.featured_image,
              meta_title: obj.meta_title,
              meta_description: obj.meta_description,
              meta_keywords: obj.meta_keywords,
              slug: obj.slug,
              status: obj.status,
            },
            `WHERE id = ${isSku.id}`
          );

          //return product ids for updating the specs and faqs
          return isSku.id;
        } catch (error) {
          console.log(error);
        }
      } else {
        const query = `INSERT INTO products (name, category_id, sku, quantity, price, selling_price, discount, weight, gross_weight, description, care, disclaimer, packing_delivery, terms_conditions, featured_image, meta_title, meta_description, meta_keywords, slug, status) values `;
        let subQuery = "";

        subQuery += `('${obj.name}', ${obj.category_id}, '${obj.sku}', ${obj.quantity}, ${obj.price}, ${obj.selling_price}, ${obj.discount}, ${obj.weight}, ${obj.gross_weight}, '${obj.description}', '${obj.care}', '${obj.disclaimer}', '${obj.packing_delivery}', '${obj.terms_conditions}', '${obj.featured_image}', '${obj.meta_title}', '${obj.meta_description}', '${obj.meta_keywords}', '${obj.slug}', ${obj.status} ),`;
        subQuery = query + subQuery.replace(/.$/, "");

        try {
          const ids = await database.executeQuery(subQuery + ";");
          return ids.insertId;
        } catch (error) {
          console.log(error);
        }
      }
    })
  );

  productIds = await productIds;

  //created data structure
  const productSpecificationTableData = keyValueSpecificationAndFaqs(
    finalData,
    "title",
    "value",
    "order_no",
    "product_specification"
  );

  try {
    //insert data into product_specifications table
    insertProductRealtedTableData(
      productSpecificationTableData,
      productIds,
      "title",
      "value",
      "order_no",
      "product_specifications"
    );
  } catch (error) {
    console.log(error);
  }

  //created data structure
  const productFaqsTableData = keyValueSpecificationAndFaqs(
    finalData,
    "question",
    "answer",
    "order_no",
    "faqs"
  );

  try {
    // //insert data into product_faqs table
    insertProductRealtedTableData(
      productFaqsTableData,
      productIds,
      "question",
      "answer",
      "order_no",
      "product_faqs"
    );
  } catch (error) {
    console.log(error);
  }
  //created data structure
  const productGalleryTableData = keyValueSpecificationAndFaqs(
    finalData,
    false,
    "image",
    false,
    "gallery"
  );

  try {
    //insert data into product_images table
    insertProductRealtedTableData(
      productGalleryTableData,
      productIds,
      "image",
      false,
      false,
      "product_images"
    );
  } catch (error) {
    console.log(error);
  }

  //created data structure
  const productPartsTableData = keyValueSpecificationAndFaqs(
    finalData,
    "image",
    "title",
    "description",
    "productParts"
  );

  try {
    // //insert data into product_faqs table
    insertProductRealtedTableData(
      productPartsTableData,
      productIds,
      "image",
      "title",
      "description",
      "product_parts"
    );
  } catch (error) {
    console.log(error);
  }

  //delete file after all data processing completed
  fs.unlinkSync(finalFilePath);

  await req.flash("success", "Products updated successfully.");
  res.redirect(adminUrl + "/product");
};

//saving only products table data
const downloadCsvFile = async (req, res) => {
  const products = await database.executeQuery("SELECT * FROM products");

  const manipulateProductsData = Promise.all(
    products.map(async (obj) => {
      return {
        product_name: obj.name,
        product_category: await database
          .getSingleRowQuery(
            `SELECT title FROM categories WHERE id = ${obj.category_id}`
          )
          .then((res) => res.title),
        sku_code: obj.sku,
        product_quantity: obj.quantity,
        product_price: obj.price,
        product_selling_price: obj.selling_price,
        product_discount: obj.discount,
        product_weigth_in_grams: obj.weight,
        product_gross_weight: obj.gross_weight,
        product_description: obj.description,
        product_care: obj.care,
        product_disclaimer: obj.disclaimer,
        product_packing_delivery: obj.packing_delivery,
        product_terms_conditions: obj.terms_conditions,
        product_featured_img: obj.featured_image,
        // product_specification: await database.getMultipleRowsQuery(
        //   `SELECT title, value, order_no FROM product_specifications WHERE product_id = ${obj.id}`
        // ),
        // product_faq: await database.getMultipleRowsQuery(
        //   `SELECT question, answer, order_no FROM product_faqs WHERE product_id = ${obj.id}`
        // ),
        product_meta_title: obj.meta_title,
        product_meta_description: obj.meta_description,
        product_meta_keywords: obj.meta_keywords,
        product_name: obj.slug,
        product_order_no: obj.order_no,
      };
    })
  );

  // const productsData = (await manipulateProductsData).map((obj) => {
  //   return {
  //     product_name: obj.productName,
  //     product_category: obj.product_category,
  //     sku_code: obj.sku_code,
  //     product_quantity: obj.product_quantity,
  //     product_price: obj.product_price,
  //     product_selling_price: obj.product_selling_price,
  //     product_discount: obj.product_discount,
  //     product_weigth_in_grams: obj.product_weigth_in_grams,
  //     product_description: obj.product_description,
  //     product_care: obj.product_care,
  //     product_disclaimer: obj.product_disclaimer,
  //     product_packing_delivery: obj.product_packing_delivery,
  //     product_terms_conditions: obj.product_terms_conditions,
  //     product_meta_title: obj.product_meta_title,
  //     product_meta_description: obj.product_meta_description,
  //     product_meta_keywords: obj.product_meta_keywords,
  //     product_name: obj.product_name,
  //     product_order_no: obj.product_order_no,
  //   };
  // });

  // const prodSpecsAndFaqs = (await manipulateProductsData).map((obj) => {
  //   return {
  //     product_specification: (function () {
  //       return obj.product_specification.reduce((acc, obj) => {
  //         let joinValues = `${obj.title} | ${obj.value} | ${obj.order_no}`;
  //         acc.push(joinValues);
  //         return acc;
  //       }, []);
  //     })(),
  //     product_faq: (function () {
  //       return obj.product_faq.reduce((acc, obj) => {
  //         let joinValues = `${obj.question} | ${obj.answer} | ${obj.order_no}`;
  //         acc.push(joinValues);
  //         return acc;
  //       }, []);
  //     })(),
  //   };
  // });

  // console.log(await manipulateProductsData);
  // return;

  const workSheet = readXlsx.utils.json_to_sheet(await manipulateProductsData);

  // console.log(workSheet);
  // return;

  const workBook = readXlsx.utils.book_new();

  readXlsx.utils.book_append_sheet(workBook, workSheet, "Sheet 1");
  const fileName = `${moment().format(
    "DD-MM-YYYY"
  )}-${crypto.randomUUID()}.xlsx`;

  readXlsx.writeFile(workBook, fileName);

  // const filePath = path.join(__dirname, "../../"); //absolute path
  // const finalFilePath = filePath + "sample.xlsx";

  // let workbook = readXlsx.readFile(finalFilePath);

  // let first_sheet_name = workbook.SheetNames[0];
  // let worksheet = workbook.Sheets[first_sheet_name];

  // readXlsx.utils.sheet_add_aoa(
  //   worksheet,
  //   [["hello | worlds"], ["hello | worlds"]],
  //   {
  //     origin: "N2",
  //   }
  // );

  // readXlsx.writeFile(workbook, "sample.xlsx");
  const filePath = path.join(__dirname, "..", "..", fileName);
  res.download(filePath, (err) => {
    err ? console.log(err) : fs.unlinkSync(filePath);
  });
};

module.exports = {
  storeCsv: storeCsv,
  downloadCsvFile: downloadCsvFile,
  uploadImage,
};
