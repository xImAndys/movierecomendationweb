require('dotenv').config();
const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const ejs = require('ejs');
const path = require('path');
const app = express();

mongoose.connect('mongodb://localhost:27017/movieMixer', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, unique: true },
    password: String
}));

const movieSchema = new mongoose.Schema({
    title: String,
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    addedAt: { type: Date, default: Date.now }
});

const recommendationSchema = new mongoose.Schema({
    title: String,
    description: String
});

const Lobby = mongoose.model('Lobby', new mongoose.Schema({
    code: { type: String, unique: true },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    movies: [movieSchema],
    recommendations: [recommendationSchema],
    createdAt: { type: Date, default: Date.now }
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false
}));

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.get('/', (req, res) => {
    res.render('home', { user: req.session.user });
});

app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.user = user;
        res.redirect('/');
    } else {
        res.render('login', { error: 'Invalid credentials' });
    }
});

app.get('/register', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const user = new User({
            username: req.body.username,
            password: hashedPassword
        });
        await user.save();
        req.session.user = user;
        res.redirect('/');
    } catch {
        res.render('register', { error: 'Registration failed' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/create-lobby', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.render('create-lobby');
});

app.post('/create-lobby', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    
    const lobbyCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const lobby = new Lobby({
        code: lobbyCode,
        creator: req.session.user._id,
        members: [req.session.user._id]
    });
    
    await lobby.save();
    res.redirect(`/lobby/${lobbyCode}`);
});

app.get('/lobby/:code', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    
    const lobby = await Lobby.findOne({ code: req.params.code })
        .populate('creator')
        .populate('members')
        .populate('movies.addedBy');
    
    if (!lobby) return res.status(404).send('Lobby not found');
    
    const isMember = lobby.members.some(member => member._id.equals(req.session.user._id));
    if (!isMember) {
        lobby.members.push(req.session.user._id);
        await lobby.save();
        
        const updatedLobby = await Lobby.findOne({ code: req.params.code })
            .populate('creator')
            .populate('members')
            .populate('movies.addedBy');
            
        return res.render('lobby', { 
            user: req.session.user, 
            lobby: updatedLobby,
            isCreator: updatedLobby.creator._id.equals(req.session.user._id)
        });
    }
    
    res.render('lobby', { 
        user: req.session.user, 
        lobby,
        isCreator: lobby.creator._id.equals(req.session.user._id)
    });
});

app.post('/lobby/:code/add-movie', async (req, res) => {
    if (!req.session.user) return res.status(401).send('Unauthorized');
    
    const lobby = await Lobby.findOne({ code: req.params.code });
    if (!lobby) return res.status(404).send('Lobby not found');
    
    const isMember = lobby.members.some(member => member.equals(req.session.user._id));
    if (!isMember) return res.status(403).send('Not a member');
    
    const userMovieCount = lobby.movies.filter(movie => 
        movie.addedBy && movie.addedBy.equals(req.session.user._id)
    ).length;
    
    if (userMovieCount >= 3) {
        return res.status(400).send('You can only add up to 3 movies');
    }
    
    if (req.body.movie) {
        const movieExists = lobby.movies.some(m => m.title.toLowerCase() === req.body.movie.toLowerCase());
        if (!movieExists) {
            lobby.movies.push({
                title: req.body.movie,
                addedBy: req.session.user._id
            });
            await lobby.save();
            
            const updatedLobby = await Lobby.findOne({ code: req.params.code })
                .populate('movies.addedBy')
                .populate('creator')
                .populate('members');
                
            return res.redirect(`/lobby/${req.params.code}`);
        }
    }
    
    res.redirect(`/lobby/${req.params.code}`);
});

app.post('/lobby/:code/remove-movie', async (req, res) => {
    if (!req.session.user) return res.status(401).send('Unauthorized');
    
    const lobby = await Lobby.findOne({ code: req.params.code })
        .populate('creator')
        .populate('movies.addedBy');
    
    if (!lobby) return res.status(404).send('Lobby not found');
    
    const isCreator = lobby.creator._id.equals(req.session.user._id);
    const movieIndex = lobby.movies.findIndex(movie => movie._id.equals(req.body.movieId));
    
    if (movieIndex === -1) return res.status(404).send('Movie not found');
    
    const movie = lobby.movies[movieIndex];
    const isMovieOwner = movie.addedBy && movie.addedBy._id.equals(req.session.user._id);
    
    if (isCreator || isMovieOwner) {
        lobby.movies.splice(movieIndex, 1);
        await lobby.save();
        
        const updatedLobby = await Lobby.findOne({ code: req.params.code })
            .populate('creator')
            .populate('members')
            .populate('movies.addedBy');
            
        return res.redirect(`/lobby/${req.params.code}`);
    }
    
    return res.status(403).send('Not authorized to remove this movie');
});

app.post('/lobby/:code/generate', async (req, res) => {
    if (!req.session.user) return res.status(401).send('Unauthorized');
    
    const lobby = await Lobby.findOne({ code: req.params.code })
        .populate('creator')
        .populate('members');
    
    if (!lobby) return res.status(404).send('Lobby not found');
    if (!lobby.creator._id.equals(req.session.user._id)) {
        return res.status(403).send('Only the lobby creator can generate recommendations');
    }

    const allMembersHaveEnoughMovies = lobby.members.every(member => {
        const memberMovieCount = lobby.movies.filter(movie => 
            movie.addedBy && movie.addedBy.equals(member._id)
        ).length;
        return memberMovieCount >= 2;
    });
    
    if (!allMembersHaveEnoughMovies) {
        return res.status(400).send('Each member must add at least 2 movies before generating recommendations');
    }
    
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const prompt = `Based on these movies that a group of people like: ${lobby.movies.map(m => m.title).join(', ')}, recommend 5 movies that the whole group might enjoy watching together. For each movie, provide the title and also add in paranthesis beside the title if its a Movie or a TV Show and also the year it was released and also the genre in the title, followed by a short description(2-3 sentences) of why it would be a good choice and based on what movies you recommended it. Format your response as a JSON array with objects containing "title" and "description" properties. Only respond with the JSON array, no additional text.`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        try {
            let cleanText = text.trim();
            if (cleanText.startsWith('```')) {
                cleanText = cleanText.replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
            }
            const jsonMatch = cleanText.match(/\[.*\]/s);
            if (!jsonMatch) {
                console.error('Could not extract JSON array from Gemini response:', cleanText);
                return res.status(500).send('Error processing recommendations');
            }

            const recommendations = JSON.parse(jsonMatch[0]);
            lobby.recommendations = recommendations.slice(0, 5);
            await lobby.save();
            console.log("Raw Gemini response:", text);
            console.log("Cleaned response:", cleanText);
            console.log("Parsed recommendations:", recommendations);
            res.redirect(`/lobby/${req.params.code}`);
        } catch (e) {
            console.error('Error parsing recommendations:', e);
            res.status(500).send('Error processing recommendations');
        }
    } catch (error) {
        console.error('Error generating recommendations:', error);
        res.status(500).send('Error generating recommendations');
    }
});

app.get('/join-lobby', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.render('join-lobby', { user: req.session.user });
});

app.post('/join-lobby', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    
    const lobbyCode = req.body.lobbyCode.toUpperCase();
    const lobby = await Lobby.findOne({ code: lobbyCode });
    
    if (!lobby) {
        return res.render('join-lobby', { 
            user: req.session.user,
            error: 'Lobby not found. Please check the code and try again.'
        });
    }
    
    res.redirect(`/lobby/${lobbyCode}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});