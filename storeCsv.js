const fs = require("fs");
const path = require("path");
const readXlsx = require("xlsx");
const database = require("../../services/databaseServices");
const { createSlug } = require("../../services/index");

const keyValueSpecificationAndFaqs = (
  finalData,
  title,
  value,
  order_no,
  extractKey
) => {
  return finalData.map((ele) => {
    let values = ele[extractKey].join("").split("|");

    let convertedValues = [];

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

const insertSpecificationOrFaqs = (
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
      } else {
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
    });
  });
};

module.exports = {
  index: async function index(req, res) {
    var action = req.query.action;
    switch (action) {
      case "add":
        add(req, res);
        break;
      case "edit":
        edit(req, res);
        break;
      case "view":
        view(req, res);
        break;
      case "delete":
        destroy(req, res);
        break;
      default:
        list(req, res);
    }
  },

  storeCsv: async function storeCsv(req, res) {
    const filePath = path.join(__dirname, "../../"); //absolute path
    const finalFilePath =
      filePath + "public/uploads/events/" + req.files[0].filename;

    //file path to read file
    const file = readXlsx.readFile(finalFilePath);

    let data = [];

    const sheets = file.SheetNames;

    //extract data from xlsx / csv file and convert into json format
    for (let i = 0; i < sheets.length; i++) {
      const temp = readXlsx.utils.sheet_to_json(
        file.Sheets[file.SheetNames[i]],
        { blankrows: true }
      );

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
        }

        finalProductSpecification = finalProductSpecification.map((obj) => {
          return obj.product_specification;
        });

        finalFaqs = finalFaqs.map((obj) => {
          return obj.product_faq;
        });

        let newObj = [...temp, { finalProductSpecification }, { finalFaqs }];

        newObj = Object.assign({}, ...newObj); //convert array of object into one big object

        groupArrayWithProductName.push(newObj);

        //flushing variables
        delete temp;
        delete finalProductSpecification;
        delete finalFaqs;
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
        weight: obj.product_weigth_in_grams,
        description: obj.product_description,
        care: obj.product_care,
        disclaimer: obj.product_disclaimer,
        packing_delivery: obj.product_packing_delivery,
        terms_conditions: obj.product_terms_conditions,
        meta_title: obj.product_meta_title,
        meta_description: obj.product_meta_description,
        meta_keywords: obj.product_meta_keywords,
        slug: obj.product_name,
        order_no: obj.product_order_no,
        product_specification: obj.finalProductSpecification,
        faqs: obj.finalFaqs,
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
              description: obj.description,
              care: obj.care,
              disclaimer: obj.disclaimer,
              packing_delivery: obj.packing_delivery,
              terms_conditions: obj.terms_conditions,
              meta_title: obj.meta_title,
              meta_description: obj.meta_description,
              meta_keywords: obj.meta_keywords,
              slug: createSlug(obj.name),
              order_no: obj.order_no,
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
                description: obj.description,
                care: obj.care,
                disclaimer: obj.disclaimer,
                packing_delivery: obj.packing_delivery,
                terms_conditions: obj.terms_conditions,
                meta_title: obj.meta_title,
                meta_description: obj.meta_description,
                meta_keywords: obj.meta_keywords,
                slug: obj.slug,
                order_no: obj.order_no,
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
          const query = `INSERT INTO products (name, category_id, sku, quantity, price, selling_price, discount, weight, description, care, disclaimer, packing_delivery, terms_conditions, meta_title, meta_description, meta_keywords, slug, order_no, status) values `;
          let subQuery = "";

          subQuery += `('${obj.name}', ${obj.category_id}, '${obj.sku}', ${obj.quantity}, ${obj.price}, ${obj.selling_price}, ${obj.discount}, ${obj.weight}, '${obj.description}', '${obj.care}', '${obj.disclaimer}', '${obj.packing_delivery}', '${obj.terms_conditions}', '${obj.meta_title}', '${obj.meta_description}', '${obj.meta_keywords}', '${obj.slug}', ${obj.order_no}, ${obj.status} ),`;
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

    //insert data into product_specifications table
    insertSpecificationOrFaqs(
      productSpecificationTableData,
      productIds,
      "title",
      "value",
      "order_no",
      "product_specifications"
    );

    //created data structure
    const productFaqsTableData = keyValueSpecificationAndFaqs(
      finalData,
      "question",
      "answer",
      "order_no",
      "faqs"
    );

    // //insert data into product_faqs table
    insertSpecificationOrFaqs(
      productFaqsTableData,
      productIds,
      "question",
      "answer",
      "order_no",
      "product_faqs"
    );

    //delete file after all data processing completed
    fs.unlinkSync(finalFilePath);

    await req.flash("success", "Products updated successfully.");
    res.redirect(adminUrl + "/product");
  },
};
