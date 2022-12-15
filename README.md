# excel-read-upload
Read xlsx/csv sheet and update into db with mysql

Restrictions when upload products from csv/excel

1. sku_code column cell data must be unique
2. All columns must have data, can be blank any cell
3. After one record added in csv/excel sheet then, then next record must have insert as first one is over insertion is over
4. Must have all data one after other, make sure not any row blank in the csv/sheet
5. product_parts, product_gallery, product_specification and product_faq columns will have take data with seprator ( | ) with pipe symbol as shown in sheet as exact format.
