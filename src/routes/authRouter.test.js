const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let menuItem = { "title":"Student", "description": "No topping, no sauce, just carbs", "image":"pizza9.png", "price": 0.0001 }
let adminUser = { password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
let testUserAuthToken;
let adminUserAuthToken;
let adminUserID;
let adminUserName;
let franchiseID; 

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);

  adminUser.name = randomName();
  adminUser.email = adminUser.name + '@admin.com';
  adminUser = await DB.addUser(adminUser);
  adminUser.password = 'toomanysecrets';
  const loginAdmin = await request(app).put('/api/auth').send(adminUser);
  adminUserAuthToken = loginAdmin.body.token;
  adminUserID = adminUser.id;
  adminUserName = adminUser.name;
  expectValidJwt(adminUserAuthToken);

  menuItem = await DB.addMenuItem(menuItem);
});

test('login', async () => {
  const loginRes = await request(app).put('/api/auth').send(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);

  const expectedUser = { ...testUser, roles: [{ role: 'diner' }] };
  delete expectedUser.password;
  expect(loginRes.body.user).toMatchObject(expectedUser);
});

test('get pizza menu', async () => {
  const pizzaMenu = await request(app).get('/api/order/menu');
  expect(pizzaMenu.status).toBe(200);

  expect(Array.isArray(pizzaMenu.body)).toBeTruthy();
});

test('order pizza', async () => {
  const pizzaOrder = await request(app).post('/api/order').send({"franchiseId": 1, "storeId":1, "items":[{ "menuId": menuItem.id, "description": "Veggie", "price": 0.05 }]}).set('Authorization', ' Bearer ' + testUserAuthToken);
  expect(pizzaOrder.status).toBe(200);
});

test('add menu item', async () => {
  const newMenuItem = await request(app).put('/api/order/menu').send({ "title":"Student", "description": "No topping, no sauce, just carbs", "image":"pizza9.png", "price": 0.0001 }).set('Authorization', ' Bearer ' + adminUserAuthToken);
  expect(newMenuItem.status).toBe(200);
});

test('get all franchises', async () => {
  const allFranchises = await request(app).get('/api/franchise?page=0&limit=10&name=*')
  expect(allFranchises.status).toBe(200);
});

test('create a franchise', async () => {
  const newFranchise = await request(app).post('/api/franchise').set('Authorization', ' Bearer ' + adminUserAuthToken).send({"name": randomName(), "admins": [{"email": adminUserName + "@admin.com"}]});
  expect(newFranchise.status).toBe(200);

  franchiseID = newFranchise.body.id;
});

test('get user franchises', async () => {
  const getUserFranchise = await request(app).get('/api/franchise/' + adminUserID).set('Authorization', ' Bearer ' + adminUserAuthToken);
  expect(getUserFranchise.status).toBe(200);
});

test('delete user franchise', async () => {
  const deleteUserFranchise = await request(app).delete('/api/franchise/' + franchiseID);
  expect(deleteUserFranchise.status).toBe(200);
});

test('update user', async () => {
  const updateUser = await request(app).put('/api/user/' + adminUserID).send({"name":"常用名字", "email": adminUserName + "@admin.com", "password":"toomanysecrets"}).set('Authorization', ' Bearer ' + adminUserAuthToken);
  expect(updateUser.status).toBe(200);
});

test('list users with not admin', async () => {
  const [user, userToken] = await registerUser(request(app));
  const listUsersRes = await request(app)
    .get('/api/user')
    .set('Authorization', 'Bearer ' + userToken);
  expect(listUsersRes.status).toBe(403);
  expect(user.name).toBe('pizza diner');
});

test('list users with admin role', async () => {
  const listUsersRes = await request(app)
    .get('/api/user')
    .set('Authorization', 'Bearer ' + adminUserAuthToken);
  expect(listUsersRes.status).toBe(200);

  const users = listUsersRes.body.users;
  expect(Array.isArray(users)).toBe(true);
  expect(users.length).toBeGreaterThan(0);
  for (const user of users) {
    expect(user).toMatchObject( {id: expect.any(Number), name: expect.any(String), email: expect.any(String)} );
  } 
});

test('list users for pagination', async () => {
  for (let i = 0; i < 4; i++) {
    await registerUser(request(app));
  }

  const page1 = await request(app)
    .get('/api/user')
    .query({ limit: 2 })
    .set('Authorization', 'Bearer ' + adminUserAuthToken);
  expect(page1.body.users.length).toBe(2);
  expect(page1.body.more).toBe(true);

  const firstFour = await request(app)
    .get('/api/user')
    .query({ limit: 4 })
    .set('Authorization', 'Bearer ' + adminUserAuthToken);

  const page2 = await request(app)
    .get('/api/user')
    .query({ page: 2, limit: 2 })
    .set('Authorization', 'Bearer ' + adminUserAuthToken);

  const ids = (res) => res.body.users.map((u) => u. id );
  expect(ids(page2)).toEqual(ids(firstFour).slice(2));
});

test('user name filter', async () => {
  const tag = randomName();
  const user = await DB.addUser({ name: tag + ' diner', email: tag + '@jwt_test.com', password: 'a', roles: [{ role: Role.Diner }] });

  const returnName = await request(app)
    .get('/api/user')
    .query({ name: tag + ' diner' })
    .set('Authorization', 'Bearer ' + adminUserAuthToken);
  expect(returnName.body.users.map((u) => u.id )).toEqual([user.id]);   
  
  const wildcardName = await request(app)
    .get('/api/user')
    .query({ name: tag + '*' })
    .set('Authorization', 'Bearer ' + adminUserAuthToken);
  expect(wildcardName.body.users.map((u) => u.id )).toEqual([user.id]);  
});

test('delete user with no admin', async () => {
  const [user, userToken] = await registerUser(request(app));
  const deleteRes = await request(app)
    .delete('/api/user/' + adminUserID)
    .set('Authorization', 'Bearer ' + userToken);
  expect(deleteRes.status).toBe(403);
  expect(user.name).toBe('pizza diner');
});

test('delete user (with admin)', async () => {
  const tag = randomName();
  const user = await DB.addUser({ name: tag + ' diner', email: tag + '@jwt_test.com', password: 'a', roles: [{ role: Role.Diner }] });

  const deleteRes = await request(app)
    .delete('/api/user/' + user.id)
    .set('Authorization', 'Bearer ' + adminUserAuthToken);
    console.log(deleteRes.status, deleteRes.body);
});

test('logout', async () => {
  const logoutUser = await request(app).delete('/api/auth').set('Authorization', ' Bearer ' + adminUserAuthToken);
  expect(logoutUser.status).toBe(200);
});

async function registerUser(service) {
  const testUser = {
    name: 'pizza diner',
    email: `${randomName()}@test.com`,
    password: 'a',
  };
  const registerRes = await service.post('/api/auth').send(testUser);
  registerRes.body.user.password = testUser.password;

  return [registerRes.body.user, registerRes.body.token];
}

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}
